import { requireAdminPermission } from "../../../lib/adminAuth";
import { recordAuditEvent } from "../../../lib/auditLog";
import { getWebhookQueueStats } from "../../../lib/paystackWebhookQueue";
import { listManualReviewOrders, listChargedButRejectedOrders } from "../../../lib/store";

// Admin check is deliberately READ-ONLY. It must never send an order to
// Techlink or mark a customer order delivered. Explicit processing remains
// an admin decision in Needs attention.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminPermission(req, res, "worker.run");
  if (!actor) return;
  try {
    const [webhooks, manual, charged] = await Promise.all([
      getWebhookQueueStats(),
      listManualReviewOrders(100),
      listChargedButRejectedOrders(100),
    ]);
    const totalManual = new Set([
      ...(manual || []).map((order) => order.reference),
      ...(charged || []).map((order) => order.reference),
    ]).size;

    await recordAuditEvent({
      actor: actor.username,
      action: "admin_checked_outstanding_orders",
      note: `Read-only check: ${totalManual} order(s) visible for review; ${webhooks.pending ?? 0} webhook job(s) pending; no customer orders processed`,
    });

    return res.status(200).json({
      mode: "review_only",
      message: `Checked outstanding orders. ${totalManual} order(s) are available for manual review. No customer orders were processed.`,
      processed: 0,
      results: [],
      failures: [],
      webhooks,
      manualReview: {
        total: totalManual,
        orders: (manual || []).map((order) => ({
          reference: order.reference,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
        })),
      },
    });
  } catch (err) {
    console.error("Outstanding-order check failed", err);
    return res.status(500).json({ error: "Could not check outstanding orders" });
  }
}
