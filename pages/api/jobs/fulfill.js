import crypto from "crypto";
import { isAdminAuthed } from "../../../lib/adminAuth";
import { fulfillClaimedOrder, recoverAndListReadyOrders, checkQueuedOrders, checkTechlinkWalletBalance, alertStaleQueuedOrders } from "../../../lib/orderProcessing";
import { processPaystackWebhookQueue } from "../../../lib/paystackWebhookQueue";
import { listReadyOrders } from "../../../lib/store";

// Constant-time comparison so the worker secret can't be guessed byte-by-byte
// from response timing.
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && safeEqual(req.headers.authorization, `Bearer ${secret}`)) return true;
  // isAdminAuthed can throw (e.g. ADMIN_SESSION_SECRET missing). That must
  // read as "not authorized", never as an unhandled 500.
  try {
    return isAdminAuthed(req);
  } catch {
    return false;
  }
}

// Every step of a worker run is independent. One failing step (a transient
// Supabase or Techlink error) must not stop the others — above all it must
// not stop fulfillment of orders that customers have already paid for.
async function step(name, fn, fallback, failures) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Fulfillment worker step failed: ${name}`, err);
    if (failures) failures.push({ step: name, error: String(err?.message || err) });
    return typeof fallback === "function" ? await fallback() : fallback;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const batchSize = Math.max(1, Math.min(100, Number(process.env.FULFILLMENT_BATCH_SIZE || 3)));
    // Wallet check first so a slow or failing later step can never prevent
    // the low-balance alert.
    const failures = [];
    const walletCheck = await step("wallet-balance", () => checkTechlinkWalletBalance(), null, failures);
    const paystackWebhookResults = await step("paystack-webhook-queue", () => processPaystackWebhookQueue(batchSize), [], failures);
    // Long-waiting queued orders (incl. bulk ones that can't auto-resolve).
    const staleQueued = await step("stale-queued-alerts", () => alertStaleQueuedOrders(), null, failures);
    const queuedResults = await step("queued-order-checks", () => checkQueuedOrders(batchSize), [], failures);
    // If recovery/escalation fails, still fall back to a plain list of ready
    // orders so paid orders keep getting delivered. The fallback is a function
    // so it only runs when it is actually needed.
    const recoveredReady = await step(
      "recover-and-list-ready",
      () => recoverAndListReadyOrders(batchSize),
      () => step("list-ready-fallback", () => listReadyOrders(batchSize), [], failures),
      failures,
    );
    const orders = recoveredReady.slice(0, batchSize);
    const results = [];
    for (const order of orders) {
      // One bad order must not block the rest of the batch.
      const outcome = await step(`fulfill:${order.reference}`, () => fulfillClaimedOrder(order.reference), { kind: "worker_error" }, failures);
      results.push({ reference: order.reference, ...outcome });
    }
    // Do all the work first, then report. A non-2xx status makes the GitHub
    // Actions worker (curl --fail) go red, so a broken step is never silent.
    const status = failures.length ? 500 : 200;
    return res.status(status).json({ ...(failures.length ? { error: "One or more worker steps failed", failures } : {}), processed: results.length + queuedResults.length + paystackWebhookResults.length, paystackWebhookProcessed: paystackWebhookResults.length, paystackWebhookResults, queuedChecked: queuedResults.length, queuedResults, results, walletCheck, staleQueued });
  } catch (err) {
    console.error("Fulfillment worker error", err);
    return res.status(500).json({ error: "Fulfillment worker failed" });
  }
}
