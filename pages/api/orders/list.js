import { listOrders } from "../../../lib/store";
import { requireAdminRole } from "../../../lib/adminAuth";
import { toAdminOrder } from "../../../lib/adminOrders";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminRole(req, res, ["viewer"])) return;
  try {
    res.status(200).json({ orders: (await listOrders()).map(toAdminOrder) });
  } catch (err) {
    console.error("Orders list error", err);
    res.status(500).json({ error: "Could not load orders" });
  }
}
