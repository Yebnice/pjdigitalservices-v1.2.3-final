import { requireAdminPermission } from "../../../lib/adminAuth";
import { listOrdersPage } from "../../../lib/adminStore";
import { ORDER_FILTERS, parseIsoDate, toAdminOrder } from "../../../lib/adminOrders";

// Orders tab: server-side filter, search and pagination, so the browser never
// has to download the whole orders table. Sensitive fields (AFA identity
// details, voucher PINs and tokens in provider results) are stripped.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "orders.view")) return;
  try {
    const filter = ORDER_FILTERS[String(req.query.filter)] ? String(req.query.filter) : "all";
    const result = await listOrdersPage({
      page: req.query.page,
      pageSize: req.query.pageSize,
      filter,
      search: req.query.q,
      from: parseIsoDate(req.query.from),
      to: parseIsoDate(req.query.to),
    });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...result, filter, orders: result.orders.map(toAdminOrder) });
  } catch (err) {
    console.error("Admin orders list error", err);
    return res.status(500).json({ error: "Could not load orders" });
  }
}
