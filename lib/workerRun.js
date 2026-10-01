import { checkTechlinkWalletBalance, alertStaleQueuedOrders, checkQueuedOrders, recoverAndListReadyOrders, fulfillClaimedOrder, sweepStalePendingOrders } from "./orderProcessing";
import { processPaystackWebhookQueue } from "./paystackWebhookQueue";
import { listReadyOrders } from "./store";
import { setAppSetting } from "./appSettings";

// One pass of the background worker. Used by the scheduled job
// (pages/api/jobs/fulfill.js) AND by the dashboard's "Run worker now" button
// (pages/api/admin/run-worker.js), so both do exactly the same thing.
//
// Every step is independent: one failing step (a transient Supabase or
// Techlink error) must not stop the others — above all it must not stop
// delivery of orders customers have already paid for.

export const WORKER_HEARTBEAT_KEY = "worker_heartbeat";
// Vercel kills a function at its maxDuration (60s here, see vercel.json). Stop
// starting new work well before that, so a run ends cleanly instead of dying
// half-way through a delivery.
const TIME_BUDGET_MS = 45_000;

async function step(name, fn, fallback, failures) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Fulfillment worker step failed: ${name}`, err);
    if (failures) failures.push({ step: name, error: String(err?.message || err) });
    return typeof fallback === "function" ? await fallback() : fallback;
  }
}

export async function runWorkerCycle({ batchSize = 3, sweepLimit = 8, trigger = "schedule" } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const failures = [];

  // Wallet check first so a slow or failing later step can never prevent the low-balance alert.
  const walletCheck = await step("wallet-balance", () => checkTechlinkWalletBalance(), null, failures);
  const paystackWebhookResults = await step("paystack-webhook-queue", () => processPaystackWebhookQueue(batchSize), [], failures);
  // Checkouts still marked unpaid: ask Paystack, so paid-but-missed customers get delivered.
  const sweep = await step("stale-pending-sweep", () => sweepStalePendingOrders({ limit: sweepLimit, deadline }), null, failures);
  // A Paystack outage makes every verification fail. That must turn the run
  // red (and the GitHub job with it), not vanish into a counter.
  if (sweep?.errors) failures.push({ step: "stale-pending-sweep", error: `${sweep.errors} checkout(s) could not be verified with Paystack` });
  const staleQueued = await step("stale-queued-alerts", () => alertStaleQueuedOrders(), null, failures);
  const queuedResults = await step("queued-order-checks", () => checkQueuedOrders(batchSize), [], failures);
  // If recovery/escalation fails, still fall back to a plain list of ready
  // orders. The fallback is lazy so it only runs when actually needed.
  const recoveredReady = await step(
    "recover-and-list-ready",
    () => recoverAndListReadyOrders(batchSize),
    () => step("list-ready-fallback", () => listReadyOrders(batchSize), [], failures),
    failures,
  );

  const results = [];
  let truncated = Boolean(sweep?.truncated);
  for (const order of recoveredReady.slice(0, batchSize)) {
    if (Date.now() > deadline) { truncated = true; break; }
    // One bad order must not block the rest of the batch.
    const outcome = await step(`fulfill:${order.reference}`, () => fulfillClaimedOrder(order.reference), { kind: "worker_error" }, failures);
    results.push({ reference: order.reference, ...outcome });
  }

  const summary = {
    processed: results.length + queuedResults.length + paystackWebhookResults.length,
    paystackWebhookProcessed: paystackWebhookResults.length,
    paystackWebhookResults,
    queuedChecked: queuedResults.length,
    queuedResults,
    sweep,
    results,
    walletCheck,
    staleQueued,
    truncated,
  };

  // Heartbeat: the dashboard warns when this stops moving. Written even when
  // steps failed (so "ran but broken" is visible), never allowed to throw.
  await step("heartbeat", () => setAppSetting(WORKER_HEARTBEAT_KEY, {
    at: new Date().toISOString(),
    trigger,
    ok: failures.length === 0,
    failedSteps: failures.map((f) => f.step).slice(0, 10),
    durationMs: Date.now() - startedAt,
    processed: summary.processed,
    swept: sweep?.checked ?? 0,
    truncated,
  }), null, null);

  return { ...summary, failures };
}
