import { requireAdminRole } from "../../../lib/adminAuth";
import { checkQueuedOrder } from "../../../lib/orderProcessing";
import { recordAuditEvent } from "../../../lib/auditLog";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
  try {
    const { reference } = req.body || {};
    if (!reference) return res.status(400).json({ error: "reference is required" });
    const order = await checkQueuedOrder(String(reference).trim());
    if (!order) return res.status(404).json({ error: "Order not found" });
    await recordAuditEvent({ actor: actor.username, action: "admin_rechecked_order", reference, note: `Result: ${order.fulfillmentStatus}` });
    return res.status(200).json({ order });
  } catch (err) {
    console.error("Admin re-check order error", err);
    return res.status(500).json({ error: "Could not re-check this order with the provider" });
  }
}
