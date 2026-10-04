import { useEffect, useRef, useState } from "react";
import { ORDER_TYPE_LABELS } from "../ui";
import { adminApi, ageText, ghs, orderStatusBadge, orderNoOf, whenText } from "../../lib/adminClient";
import { Banner, DataTable, EmptyState, MONO, SearchBox, StatusPill, TD, TabButton } from "./AdminUi";
import OrderDetails from "./OrderDetails";

const FILTERS = [
  ["all", "All"],
  ["attention", "Needs attention"],
  ["paid_undelivered", "Paid, not delivered"],
  ["fulfilled", "Delivered"],
  ["failed_delivery", "Delivery failed"],
  ["payment_failed", "Payment failed"],
  ["unpaid", "Awaiting payment"],
  ["abandoned", "Abandoned"],
];

const COLUMNS = [
  { key: "n", label: "#", width: 44 },
  { key: "no", label: "Order no." },
  { key: "ref", label: "Paystack reference" },
  { key: "product", label: "Product" },
  { key: "recipient", label: "Recipient" },
  { key: "customer", label: "Customer" },
  { key: "total", label: "Total", align: "right" },
  { key: "status", label: "Status" },
  { key: "created", label: "Created" },
  { key: "open", label: "", align: "right", width: 70 },
];

export default function OrdersTab({ can, refreshTick, onUnauthorized }) {
  const [filter, setFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openRef, setOpenRef] = useState(null);
  const requestId = useRef(0);

  // Debounce typing so every keystroke is not a database query.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const qs = new URLSearchParams({ filter, page: String(page), pageSize: "25" });
    if (search) qs.set("q", search);
    adminApi(`/api/admin/orders?${qs.toString()}`, { onUnauthorized })
      .then((d) => { if (id === requestId.current) { setData(d); setError(""); } })
      .catch((err) => { if (id === requestId.current) setError(err.message); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [filter, search, page, refreshTick, onUnauthorized]);

  const orders = data?.orders || [];
  const offset = data ? (data.page - 1) * data.pageSize : 0;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTERS.map(([id, label]) => (
          <TabButton key={id} active={filter === id} onClick={() => { setFilter(id); setPage(1); setOpenRef(null); }}>{label}</TabButton>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Search order no., Paystack reference or transaction ID, phone, email…" style={{ flex: 1, minWidth: 260, maxWidth: 520 }} />
        {can("orders.export") && (
          <a href="/api/admin/export-orders" className="nav-item" style={{ width: "auto", padding: "8px 16px", textDecoration: "none" }}>Export all orders (CSV)</a>
        )}
      </div>
      {error && <Banner tone="amber">Couldn't load orders ({error}).</Banner>}
      <div className="card" style={{ overflow: "hidden", opacity: loading ? 0.6 : 1 }}>
        {!data && !error && <EmptyState>Loading orders…</EmptyState>}
        {data && orders.length === 0 && <EmptyState>{search ? `No orders match “${search}”.` : "No orders in this view."}</EmptyState>}
        {orders.length > 0 && (
          <DataTable columns={COLUMNS} minWidth={1060}>
            {orders.map((o, i) => {
              const badge = orderStatusBadge(o);
              const open = openRef === o.reference;
              return [
                <tr key={o.reference} style={{ background: open ? "var(--surface-raised)" : undefined, cursor: "pointer" }} onClick={() => setOpenRef(open ? null : o.reference)}>
                  <td style={{ ...TD, color: "var(--muted-dim)" }}>{offset + i + 1}</td>
                  <td style={{ ...TD, fontWeight: 600 }}><span style={MONO}>{orderNoOf(o)}</span></td>
                  <td style={TD}><span style={MONO}>{o.reference}</span></td>
                  <td style={TD}>{ORDER_TYPE_LABELS[o.orderType] || o.orderType}{o.network ? <div style={{ fontSize: 11, color: "var(--muted-dim)", textTransform: "uppercase" }}>{o.network}</div> : null}</td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>{o.phone || "—"}</td>
                  <td style={{ ...TD, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.email}>{o.email || "—"}</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{ghs(o.checkoutAmount ?? o.amount)}</td>
                  <td style={TD}><StatusPill text={badge.text} tone={badge.tone} /></td>
                  <td style={{ ...TD, whiteSpace: "nowrap", color: "var(--muted)" }} title={whenText(o.createdAt)}>{whenText(o.createdAt)}<div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{ageText(o.createdAt)} ago</div></td>
                  <td style={{ ...TD, textAlign: "right", color: "var(--muted-dim)", fontSize: 12 }}>{open ? "Hide ▲" : "Details ▼"}</td>
                </tr>,
                open && (
                  <tr key={`${o.reference}-d`}>
                    <td colSpan={COLUMNS.length} style={{ padding: 0, background: "var(--surface-raised)", borderBottom: "1px solid var(--line)" }}><OrderDetails order={o} /></td>
                  </tr>
                ),
              ];
            })}
          </DataTable>
        )}
      </div>
      {data && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>{data.total} order{data.total === 1 ? "" : "s"} · page {data.page} of {data.totalPages}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="nav-item" style={{ width: "auto", padding: "6px 12px" }} disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Newer</button>
            <button className="nav-item" style={{ width: "auto", padding: "6px 12px" }} disabled={page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Older →</button>
          </div>
        </div>
      )}
    </div>
  );
}
