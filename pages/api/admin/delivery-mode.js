import { requireAdminRole } from "../../../lib/adminAuth";
import { getDeliveryMode, setDeliveryMode } from "../../../lib/deliveryMode";
import { autoDeliveryMaxAgeMinutes, DELIVERY_MODES } from "../../../lib/deliveryPolicy";
import { recordAuditEvent } from "../../../lib/auditLog";

// The safety switch. Any operator can READ it; only an admin can CHANGE it.
export default async function handler(req, res) {
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({ mode: await getDeliveryMode(), modes: DELIVERY_MODES, autoMaxAgeMinutes: autoDeliveryMaxAgeMinutes() });
  }
  if (req.method === "POST") {
    if (actor.role !== "admin") return res.status(403).json({ error: "Only an admin can change the delivery mode" });
    try {
      const before = await getDeliveryMode();
      const mode = await setDeliveryMode(req.body?.mode, actor.username);
      await recordAuditEvent({ actor: actor.username, action: "admin_changed_delivery_mode", note: `Delivery mode ${before} -> ${mode}` });
      return res.status(200).json({ mode });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}
