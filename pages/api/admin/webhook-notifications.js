import { requireAdminPermission } from "../../../lib/adminAuth";
import { listOpenWebhookNotifications } from "../../../lib/paystackWebhookQueue";

// The "Paystack notifications" table: every payment notification Paystack sent that has not
// been fully settled yet, with the order it belongs to. READ-ONLY. Nothing here sends an order
// to Techlink; the admin decides on the Needs attention tab (Verify with Paystack, Approve &
// deliver, or close).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "system.view")) return;
  try {
    const notifications = await listOpenWebhookNotifications(200);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ notifications });
  } catch (err) {
    console.error("Paystack notifications list failed", err);
    return res.status(500).json({ error: "Could not load the Paystack notifications" });
  }
}
