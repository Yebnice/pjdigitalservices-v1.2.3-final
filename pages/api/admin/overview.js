import { requireAdminPermission } from "../../../lib/adminAuth";
import { listOrdersForOverview, listPaidUndelivered } from "../../../lib/adminStore";
import { computeOverview, OVERVIEW_RANGES, rangeStart } from "../../../lib/adminOverview";

// Dashboard headline numbers, computed on the server over every order in the
// selected range (see lib/adminOverview.js for the definitions).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "overview.view")) return;
  try {
    const range = OVERVIEW_RANGES[String(req.query.range)] ? String(req.query.range) : "7d";
    const now = new Date();
    const start = rangeStart(range, now);
    const [orders, atRiskOrders] = await Promise.all([
      listOrdersForOverview(start ? start.toISOString() : null),
      listPaidUndelivered(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(computeOverview(orders, { range, now, atRiskOrders }));
  } catch (err) {
    console.error("Admin overview error", err);
    return res.status(500).json({ error: "Could not load the overview" });
  }
}
