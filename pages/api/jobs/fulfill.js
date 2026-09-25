import { isAdminAuthed } from "../../../lib/adminAuth";
import { fulfillClaimedOrder, recoverAndListReadyOrders, checkQueuedOrders, checkTechlinkWalletBalance, alertStaleQueuedOrders } from "../../../lib/orderProcessing";
import { processPaystackWebhookQueue } from "../../../lib/paystackWebhookQueue";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true;
  return isAdminAuthed(req);
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const batchSize = Math.max(1, Math.min(100, Number(process.env.FULFILLMENT_BATCH_SIZE || 3)));
    // BUG FIX: the comment below has always claimed the wallet-balance check
    // "runs FIRST so a slow/failed fulfillment loop... can never prevent it"
    // — but processPaystackWebhookQueue() used to be called BEFORE this
    // check, and unlike every other step here, it was never wrapped in its
    // own try/catch. claimPaystackWebhookJobs() (inside it) throws a plain
    // Error on any Supabase read/write failure during claiming, which is
    // exactly the kind of transient incident this alert exists to survive.
    // That uncaught throw would hit the outer catch below, return 500, and
    // skip the wallet check, the stale-queued alert, the queued-order
    // re-check, AND fulfillment itself for that entire 5-minute run — the
    // opposite of "can never prevent it". Moved the wallet check first for
    // real, and given webhook processing its own try/catch so one failing
    // step degrades gracefully instead of taking the whole run down.
    let walletCheck = null;
    try {
      walletCheck = await checkTechlinkWalletBalance();
    } catch (err) {
      console.error("Wallet balance check threw unexpectedly", err);
    }
    let paystackWebhookResults = [];
    try {
      paystackWebhookResults = await processPaystackWebhookQueue(batchSize);
    } catch (err) {
      console.error("Paystack webhook queue processing failed", err);
    }
    // Long-waiting queued orders (incl. bulk ones that can't auto-resolve).
    const staleQueued = await alertStaleQueuedOrders();
    const queuedResults = await checkQueuedOrders(batchSize);
    const recoveredReady = await recoverAndListReadyOrders(batchSize);
    const orders = recoveredReady.slice(0, batchSize);
    const results = [];
    for (const order of orders) {
      results.push({ reference: order.reference, ...(await fulfillClaimedOrder(order.reference)) });
    }
    return res.status(200).json({ processed: results.length + queuedResults.length + paystackWebhookResults.length, paystackWebhookProcessed: paystackWebhookResults.length, paystackWebhookResults, queuedChecked: queuedResults.length, queuedResults, results, walletCheck, staleQueued });
  } catch (err) {
    console.error("Fulfillment worker error", err);
    return res.status(500).json({ error: "Fulfillment worker failed" });
  }
}
