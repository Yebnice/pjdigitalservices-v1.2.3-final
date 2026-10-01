import { requireAdminPermission } from "../../../lib/adminAuth";
import { getOrder } from "../../../lib/store";
import { evidenceForOrder } from "../../../lib/adminEvidence";
import { retryIsSafe } from "../../../lib/techlinkMatch";

// "Did Techlink already deliver this?" — answered from Techlink's own order
// history so nobody has to guess before choosing retry vs mark delivered.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "orders.process")) return;
  try {
    const reference = String(req.query.reference || "").trim();
    if (!reference) return res.status(400).json({ error: "reference is required" });
    const order = await getOrder(reference);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const evidence = await evidenceForOrder(order);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ reference, evidence, retrySafe: retryIsSafe(evidence) });
  } catch (err) {
    console.error("Techlink check error", err);
    return res.status(500).json({ error: "Could not check Techlink right now" });
  }
}
