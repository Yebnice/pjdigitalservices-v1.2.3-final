import { useEffect, useRef, useState } from "react";
import { ORDER_TYPE_LABELS } from "../ui";
import { adminApi, ageText, ghs, orderStatusBadge } from "../../lib/adminClient";
import { Banner, EmptyState, SearchBox, StatusPill, TabButton } from "./AdminUi";

const FILTERS = [
  ["all", "All"],
  ["attention", "Needs attention"],
  ["paid_undelivered", "Paid, not delivered"],
  ["fulfilled", "Delivered"],
  ["failed_delivery", "Delivery failed"],
  ["payment_failed", "Payment failed"],
  ["charged_rejected", "Payment review"],
  ["unpaid", "Awaiting payment"],
  ["abandoned", "Abandoned"],
];

function Detail({ label, children }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div style={{ minWidth: 160 }}>
      <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{label}</div>
      <div style={{ fontSize: 13, wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function when(iso) {
  return iso ? new Date(iso).toLocaleString() : null;
}

function OrderRow({ order, open, onToggle }) {
  const badge = orderStatusBadge(order);
  const label = ORDER_TYPE_LABELS[order.orderType] || order.orderType;
  return (
    <div className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <button onClick={onToggle} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }} aria-expanded={open}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {label} <StatusPill text={badge.text} tone={badge.tone} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)", marginTop: 2 }}>
              {order.phone} · {order.reference} · {ageText(order.createdAt)} ago
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{ghs(order.checkoutAmount ?? order.amount)}</div>
            <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{open ? "Hide details ▲" : "Details ▼"}</div>
          </div>
        </div>
      </button>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", padding: "10px 12px", background: "var(--surface-raised)", borderRadius: 8 }}>
          <Detail label="Reference">{order.reference}</Detail>
          <Detail label="Email">{order.email}</Detail>
          <Detail label="Recipient / account">{order.phone}{order.meterNumber ? ` · meter ${order.meterNumber}` : ""}</Detail>
          <Detail label="Network">{order.network}</Detail>
          <Detail label="Product price">{order.customerProductAmount != null ? ghs(order.customerProductAmount) : null}</Detail>
          <Detail label="Business margin">{order.businessMarkupAmount != null ? ghs(order.businessMarkupAmount) : null}</Detail>
          <Detail label="Paystack fee (charged)">{order.paystackFeeAmount != null ? ghs(order.paystackFeeAmount) : null}</Detail>
          <Detail label="Techlink cost">{order.providerCost != null ? ghs(order.providerCost) : null}</Detail>
          <Detail label="Customer paid">{order.paymentAmountGhs != null ? ghs(order.paymentAmountGhs) : null}</Detail>
          <Detail label="Created">{when(order.createdAt)}</Detail>
          <Detail label="Payment charged">{when(order.paymentChargedAt)}</Detail>
          <Detail label="Payment verified">{when(order.paymentVerifiedAt)}</Detail>
          <Detail label="Delivered">{when(order.fulfilledAt)}</Detail>
          <Detail label="Delivery attempts">{order.fulfillmentAttempts > 0 ? order.fulfillmentAttempts : null}</Detail>
          <Detail label="Techlink order ID">{order.result?.orderId != null ? String(order.result.orderId) : null}</Detail>
          <Detail label="Fail reason">{order.failReason}</Detail>
          <Detail label="Last delivery error">{order.lastFulfillmentError}</Detail>
          <Detail label="Manual resolution">{order.manualReviewResolution}</Detail>
          <Detail label="AFA registrant">{order.afaName}</Detail>
        </div>
      )}
    </div>
  );
}

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
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTERS.map(([id, label]) => (
          <TabButton key={id} active={filter === id} onClick={() => { setFilter(id); setPage(1); setOpenRef(null); }}>{label}</TabButton>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Search reference, phone, email or type…" style={{ flex: 1, minWidth: 220 }} />
        {can("orders.export") && (
          <a href="/api/admin/export-orders" className="nav-item" style={{ width: "auto", padding: "8px 16px", textDecoration: "none" }}>Export all orders (CSV)</a>
        )}
      </div>
      {error && <Banner tone="amber">Couldn't load orders ({error}).</Banner>}
      <div className="card" style={{ overflow: "hidden", opacity: loading ? 0.6 : 1 }}>
        {!data && !error && <EmptyState>Loading orders…</EmptyState>}
        {data && orders.length === 0 && <EmptyState>{search ? `No orders match “${search}”.` : "No orders in this view."}</EmptyState>}
        {orders.map((o) => (
          <OrderRow key={o.reference} order={o} open={openRef === o.reference} onToggle={() => setOpenRef(openRef === o.reference ? null : o.reference)} />
        ))}
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
