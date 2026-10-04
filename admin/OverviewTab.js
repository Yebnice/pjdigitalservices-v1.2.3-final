import { Banner, BarChart, DataTable, EmptyState, StatCard, TabButton, TD } from "./AdminUi";
import { toCsv, downloadCsv } from "../../lib/csv";
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

// The daily close: one row per day, a totals line, and a CSV export for the books.
// Every figure counts delivered orders only; the days add up to the headline cards.
function DailyClose({ trend, rangeLabel }) {
  const rows = trend || [];
  const total = (k) => rows.reduce((n, t) => n + Number(t[k] || 0), 0);
  const cols = [
    { key: "d", label: "Day (UTC)" }, { key: "o", label: "Orders", align: "right" }, { key: "s", label: "Product sales", align: "right" },
    { key: "m", label: "Your margin", align: "right" }, { key: "p", label: "Customer payments", align: "right" },
    { key: "f", label: "Paystack fee charged", align: "right" }, { key: "c", label: "Techlink cost", align: "right" }, { key: "pr", label: "Est. profit", align: "right" },
  ];
  function exportCsv() {
    downloadCsv(`daily-close-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      { label: "Day (UTC)", key: "key" }, { label: "Delivered orders", key: "orders" }, { label: "Product sales (GHS)", key: "sales" },
      { label: "Margin (GHS)", key: "margin" }, { label: "Customer payments (GHS)", key: "payments" }, { label: "Paystack fee charged (GHS)", key: "fees" },
      { label: "Techlink cost (GHS)", key: "cost" }, { label: "Est. profit (GHS)", key: "profit" },
    ], rows));
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Daily close ({rangeLabel.toLowerCase()})</div>
          <div style={{ fontSize: 12, color: "var(--muted-dim)", marginTop: 2 }}>Delivered orders only, by the day the order was placed. Profit is an estimate: it assumes the standard Paystack rate.</div>
        </div>
        <button className="nav-item" style={{ width: "auto", padding: "6px 12px" }} onClick={exportCsv} disabled={!rows.length}>Export (CSV)</button>
      </div>
      <DataTable columns={cols} minWidth={880}>
        {rows.map((t) => (
          <tr key={t.key} style={{ color: t.orders ? undefined : "var(--muted-dim)" }}>
            <td style={TD}>{shortDay(t.key)}</td>
            <td style={{ ...TD, textAlign: "right" }}>{t.orders}</td>
            <td style={{ ...TD, textAlign: "right" }}>{ghs(t.sales)}</td>
            <td style={{ ...TD, textAlign: "right" }}>{ghs(t.margin)}</td>
            <td style={{ ...TD, textAlign: "right" }}>{ghs(t.payments)}</td>
            <td style={{ ...TD, textAlign: "right" }}>{ghs(t.fees)}</td>
            <td style={{ ...TD, textAlign: "right" }}>{ghs(t.cost)}</td>
            <td style={{ ...TD, textAlign: "right", fontWeight: 600, color: t.profit < 0 ? TONE_COLORS.red : undefined }}>{ghs(t.profit)}</td>
          </tr>
        ))}
        <tr style={{ background: "var(--surface-raised)", fontWeight: 700 }}>
          <td style={TD}>Total</td>
          <td style={{ ...TD, textAlign: "right" }}>{total("orders")}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("sales"))}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("margin"))}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("payments"))}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("fees"))}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("cost"))}</td>
          <td style={{ ...TD, textAlign: "right" }}>{ghs(total("profit"))}</td>
        </tr>
      </DataTable>
    </div>
  );
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

          {(overview.counts.deliveryFailed > 0 || overview.counts.paymentFailed > 0 || overview.counts.awaitingPayment > 0 || overview.counts.abandoned > 0) && (
            <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
              {overview.counts.deliveryFailed > 0 && <span style={{ color: TONE_COLORS.red, fontWeight: 600 }}>● {overview.counts.deliveryFailed} delivery failed</span>}
              {overview.counts.paymentFailed > 0 && <span style={{ color: TONE_COLORS.red, fontWeight: 600 }}>● {overview.counts.paymentFailed} payment failed</span>}
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
              <DataTable columns={[{ key: "p", label: "Product" }, { key: "o", label: "Orders", align: "right" }, { key: "s", label: "Sales", align: "right" }, { key: "pr", label: "Est. profit", align: "right" }]} minWidth={520}>
                {overview.products.map((p) => (
                  <tr key={p.label}>
                    <td style={TD}>{p.label}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{p.orders}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{ghs(p.sales)}</td>
                    <td style={{ ...TD, textAlign: "right", fontWeight: 600, color: p.profit < 0 ? TONE_COLORS.red : undefined }}>{ghs(p.profit)}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--surface-raised)", fontWeight: 700 }}>
                  <td style={TD}>Total</td>
                  <td style={{ ...TD, textAlign: "right" }}>{overview.products.reduce((n, p) => n + p.orders, 0)}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{ghs(overview.products.reduce((n, p) => n + p.sales, 0))}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{ghs(overview.products.reduce((n, p) => n + p.profit, 0))}</td>
                </tr>
              </DataTable>
            )}
          </div>

          <DailyClose trend={overview.trend} rangeLabel={overview.rangeLabel} />
          <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>Money figures count delivered orders only. Days are UTC (same as Ghana time). Updated {new Date(overview.generatedAt).toLocaleTimeString()}.</div>
        </>
      )}
    </div>
  );
}
