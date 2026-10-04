import { Banner, BarChart, EmptyState, StatCard, TabButton } from "./AdminUi";
import { ghs, minutesToText, TONE_COLORS } from "../../lib/adminClient";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

function shortDay(key) {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" }).replace(" ", "\u00A0");
}

export default function OverviewTab({ overview, loading, error, range, onRangeChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {RANGES.map((r) => (
          <TabButton key={r.id} active={range === r.id} onClick={() => onRangeChange(r.id)}>{r.label}</TabButton>
        ))}
        {loading && <span style={{ fontSize: 12, color: "var(--muted-dim)", alignSelf: "center" }}>Updating…</span>}
      </div>

      {error && <Banner tone="amber">Couldn't refresh the overview ({error}). {overview ? "Showing the last figures that loaded." : ""}</Banner>}
      {!overview && !error && <EmptyState>Loading overview…</EmptyState>}

      {overview && (
        <>
          {overview.atRisk.count > 0 && (
            <Banner tone="red">
              <strong>{overview.atRisk.count} paid order{overview.atRisk.count === 1 ? "" : "s"} not delivered yet</strong> — {ghs(overview.atRisk.value)} collected from customers, oldest waiting {minutesToText(overview.atRisk.oldestMinutes)}. Check the Needs attention tab.
            </Banner>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <StatCard label="Product sales" value={ghs(overview.money.productSales)} hint="Delivered orders, before Paystack fee" />
            <StatCard label="Business margin" value={ghs(overview.money.businessMargin)} hint="Your markup on delivered orders" />
            <StatCard label="Est. net profit" value={ghs(overview.money.netProfit)} tone={overview.money.netProfit < 0 ? "red" : undefined} hint="Payments − Paystack fee − Techlink cost" />
            <StatCard label="Customer payments" value={ghs(overview.money.customerPayments)} hint="Total collected on delivered orders" />
            <StatCard label="Techlink cost" value={ghs(overview.money.providerCost)} hint="What Techlink debited for these orders" />
            <StatCard label="Delivered orders" value={overview.counts.delivered} hint={`Avg ${ghs(overview.money.avgOrderValue)}`} />
            <StatCard label="Payment success" value={overview.rates.payment == null ? "—" : `${overview.rates.payment}%`} tone={overview.rates.payment != null && overview.rates.payment < 90 ? "red" : undefined} hint="Paid vs failed payments" />
            <StatCard label="Delivery success" value={overview.rates.fulfillment == null ? "—" : `${overview.rates.fulfillment}%`} tone={overview.rates.fulfillment != null && overview.rates.fulfillment < 90 ? "red" : undefined} hint="Delivered vs paid" />
          </div>

          {(overview.counts.deliveryFailed > 0 || overview.counts.paymentFailed > 0 || overview.counts.paymentRejectedAfterCharge > 0 || overview.counts.awaitingPayment > 0 || overview.counts.abandoned > 0) && (
            <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
              {overview.counts.deliveryFailed > 0 && <span style={{ color: TONE_COLORS.red, fontWeight: 600 }}>● {overview.counts.deliveryFailed} delivery failed</span>}
              {overview.counts.paymentFailed > 0 && <span style={{ color: TONE_COLORS.red, fontWeight: 600 }}>● {overview.counts.paymentFailed} payment failed</span>}
              {overview.counts.paymentRejectedAfterCharge > 0 && <span style={{ color: TONE_COLORS.amber, fontWeight: 600 }}>● {overview.counts.paymentRejectedAfterCharge} payment review</span>}
              {overview.counts.awaitingPayment > 0 && <span style={{ color: TONE_COLORS.amber, fontWeight: 600 }}>● {overview.counts.awaitingPayment} awaiting payment</span>}
              {overview.counts.abandoned > 0 && <span style={{ color: TONE_COLORS.muted }}>● {overview.counts.abandoned} abandoned checkouts</span>}
            </div>
          )}

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Product sales — last {overview.trend.length} day{overview.trend.length === 1 ? "" : "s"}</div>
            <BarChart points={overview.trend.map((t) => ({ key: t.key, label: shortDay(t.key), value: t.sales }))} format={ghs} />
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Products ({overview.rangeLabel.toLowerCase()})</div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)", marginBottom: 12 }}>Profit is an estimate. A red figure means that product is losing money after Paystack and Techlink costs.</div>
            {overview.products.length === 0 ? (
              <EmptyState>No delivered orders in this range yet.</EmptyState>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "4px 8px 8px 0", fontWeight: 500 }}>Product</th>
                      <th style={{ padding: "4px 8px 8px", fontWeight: 500, textAlign: "right" }}>Orders</th>
                      <th style={{ padding: "4px 8px 8px", fontWeight: 500, textAlign: "right" }}>Sales</th>
                      <th style={{ padding: "4px 0 8px 8px", fontWeight: 500, textAlign: "right" }}>Est. profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.products.map((p) => (
                      <tr key={p.label} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 8px 8px 0" }}>{p.label}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{p.orders}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{ghs(p.sales)}</td>
                        <td style={{ padding: "8px 0 8px 8px", textAlign: "right", fontWeight: 600, color: p.profit < 0 ? TONE_COLORS.red : undefined }}>{ghs(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>Money figures count delivered orders only. Days are UTC (same as Ghana time). Updated {new Date(overview.generatedAt).toLocaleTimeString()}.</div>
        </>
      )}
    </div>
  );
}
