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
    const batchSize = Math.max(1, Math.min(100, Number(process.env.FULFILLMENT_BATCH_SIZE || 10)));
    const paystackWebhookResults = await processPaystackWebhookQueue(batchSize);
    // Proactive wallet-balance check — runs FIRST so a slow/failed fulfillment
    // loop (or a 500 from a Supabase/Techlink incident, the exact moment the
    // alert matters) can never prevent it. Piggybacks on this 5-minute cron. Never allowed to fail
    // the fulfillment run itself (see checkTechlinkWalletBalance's own
    // try/catch); a network/config issue here just means no alert this run.
    let walletCheck = null;
    try {
      walletCheck = await checkTechlinkWalletBalance();
    } catch (err) {
      console.error("Wallet balance check threw unexpectedly", err);
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
