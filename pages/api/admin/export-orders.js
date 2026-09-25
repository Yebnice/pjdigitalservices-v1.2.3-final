import { requireAdminRole } from "../../../lib/adminAuth";
import { listOrders } from "../../../lib/store";
import { recordAuditEvent } from "../../../lib/auditLog";

// Wrap a field for safe CSV: quote it whenever it contains a comma, quote
// character, or newline, doubling any internal quotes — the standard CSV
// escaping rule. Without this, a note or error message containing a comma
// would silently shift every later column in that row.
//
// BUG FIX: this used to stop at RFC 4180 escaping, which is not enough.
// Several exported columns (most importantly `email`) come straight from
// unauthenticated customer checkout input, and Excel/Google Sheets treats
// any cell beginning with =, +, -, or @ as a FORMULA, not text — a known
// "CSV/Formula Injection" vector. A checkout email like
// `=HYPERLINK("http://evil.example","x")@a.com` passes the app's email
// regex (which only requires an "@" and a dot somewhere) and would silently
// become a live, clickable/executable formula the moment an admin opened
// this export. Any such field is now prefixed with a leading apostrophe,
// which Excel/Sheets render as inert literal text while keeping the value
// unchanged for every other consumer (plain CSV parsers, re-import, etc).
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];
function csvField(value) {
  let str = value == null ? "" : String(value);
  if (FORMULA_TRIGGER_CHARS.includes(str[0])) str = `'${str}`;
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const COLUMNS = [
  ["reference", "Reference"],
  ["orderType", "Order Type"],
  ["network", "Network"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["amount", "Product Amount (GHS)"],
  ["paystackFeeAmount", "Paystack Fee (GHS)"],
  ["checkoutAmount", "Total Charged (GHS)"],
  ["status", "Status"],
  ["fulfillmentStatus", "Fulfillment Status"],
  ["failReason", "Fail Reason"],
  ["createdAt", "Created At"],
  ["fulfilledAt", "Fulfilled At"],
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
  try {
    const orders = await listOrders();
    const header = COLUMNS.map(([, label]) => csvField(label)).join(",");
    const rows = orders.map((o) => COLUMNS.map(([key]) => csvField(o[key])).join(","));
    const csv = [header, ...rows].join("\r\n");

    await recordAuditEvent({ actor: actor.username, action: "orders_exported", note: `${orders.length} orders exported to CSV` });

    const filename = `pjdigitalservices-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error("Order export error", err);
    return res.status(500).json({ error: "Could not export orders" });
  }
}
