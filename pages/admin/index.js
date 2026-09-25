import { useEffect, useState } from "react";
import { OrderList, ORDER_TYPE_LABELS } from "../../components/ui";

function PasswordGate({ onUnlock }) {
  const [username, setUsername] = useState("admin");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function tryUnlock() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: value }),
      });
      let data = {};
      try {
        data = await r.json();
      } catch {
        throw new Error(`Server error (${r.status}). Check the deployment logs.`);
      }
      if (!r.ok) throw new Error(data.error || "Login failed");
      onUnlock({ role: data.role || "admin" });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 360 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 16px" }}>Admin login</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin username" autoComplete="username" style={{ marginBottom: 12 }} />
        <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && tryUnlock()} placeholder="Admin password" autoComplete="current-password" />
        <button className="primary-btn" onClick={tryUnlock} disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      className="nav-item"
      style={{ width: "auto", padding: "6px 12px", background: active ? "var(--surface-raised)" : "transparent", borderColor: "var(--line)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <input
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ marginBottom: 12, maxWidth: 360 }}
    />
  );
}

// ---- Overview tab: revenue trend, top products, and a date-range filter.
// Hand-rolled SVG bar chart rather than a charting library — there isn't
// one in package.json, and pulling one in for a handful of bars isn't
// worth the dependency weight.

const RANGE_OPTIONS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "all", label: "All time", days: null },
];

function productLabel(order) {
  const base = ORDER_TYPE_LABELS[order.orderType] || order.orderType || "Order";
  const productName = order.tierDetails?.name;
  const network = order.network && order.network !== order.orderType ? order.network.toUpperCase() : null;
  if (productName) return `${productName}${network ? ` (${network})` : ""}`;
  if (network && ["airtime", "data"].includes(order.orderType)) return `${base} — ${network}`;
  return base;
}

function startOfRange(days) {
  if (days == null) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function dayKey(dateLike) {
  const d = new Date(dateLike);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function BarChart({ points, valueFormatter }) {
  if (!points.length) return <div style={{ fontSize: 13, color: "var(--muted)", padding: 24, textAlign: "center" }}>No data in this range yet.</div>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 640, h = 160, padBottom = 22, barGap = 4;
  const barW = Math.max(2, w / points.length - barGap);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 160, display: "block" }} preserveAspectRatio="none">
      {points.map((p, i) => {
        const barH = ((h - padBottom) * p.value) / max;
        const x = i * (w / points.length);
        return (
          <g key={p.key}>
            <rect x={x} y={h - padBottom - barH} width={barW} height={Math.max(barH, p.value > 0 ? 2 : 0)} fill="var(--accent, #2563eb)" rx="2">
              <title>{`${p.label}: ${valueFormatter ? valueFormatter(p.value) : p.value}`}</title>
            </rect>
            {(points.length <= 10 || i % Math.ceil(points.length / 8) === 0) && (
              <text x={x + barW / 2} y={h - 6} fontSize="9" fill="var(--muted-dim)" textAnchor="middle">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function OverviewTab({ orders, feedback, manualReview, walletBalance }) {
  const [range, setRange] = useState("7d");

  const rangeDef = RANGE_OPTIONS.find((r) => r.id === range);
  const cutoff = startOfRange(rangeDef.days);
  const inRange = cutoff ? orders.filter((o) => o.createdAt && new Date(o.createdAt) >= cutoff) : orders;
  const successInRange = inRange.filter((o) => o.status === "success");\n  const paidInRange = inRange.filter((o) => ["payment_verified", "success"].includes(o.status));\n  const fulfilledInRange = inRange.filter((o) => o.fulfillmentStatus === "fulfilled");

  const revenue = successInRange.reduce((s, o) => s + Number(o.amount || 0), 0);
  const fees = successInRange.reduce((s, o) => s + Number(o.paystackFeeAmount || 0), 0);
  const avgOrder = successInRange.length ? (successInRange.reduce((s, o) => s + Number(o.checkoutAmount ?? o.amount ?? 0), 0) / successInRange.length) : 0;
  // fulfillmentStatus is the authoritative state here — "failed" can happen
  // whether the order-level `status` is "failed" (a payment-side reject) or
  // still "payment_verified" (payment went through but fulfillment didn't).
  // Keeping these two checks mutually exclusive matters: an earlier draft
  // of this counted every failed order as "pending" too.
  const failedInRange = inRange.filter((o) => o.fulfillmentStatus === "failed").length;
  const pendingInRange = inRange.filter((o) => o.status !== "success" && o.fulfillmentStatus !== "failed").length;
  const paymentSuccessRate = inRange.length ? Math.round((paidInRange.length / inRange.length) * 100) : 0;\n  const fulfillmentSuccessRate = paidInRange.length ? Math.round((fulfilledInRange.length / paidInRange.length) * 100) : 0;

  // Daily revenue trend — bucket successful orders in range by calendar day.
  const dayBuckets = {};
  const trendDays = rangeDef.days && rangeDef.days <= 30 ? rangeDef.days : 30; // cap "all time" trend to last 30 days so bars stay readable
  const trendStart = startOfRange(trendDays);
  successInRange
    .filter((o) => new Date(o.createdAt) >= trendStart)
    .forEach((o) => {
      const k = dayKey(o.createdAt);
      dayBuckets[k] = (dayBuckets[k] || 0) + Number(o.amount || 0);
    });
  const trendPoints = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    trendPoints.push({ key: k, label: d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }).replace(" ", "\u00A0"), value: Math.round((dayBuckets[k] || 0) * 100) / 100 });
  }

  // Top 5 products by revenue, within the selected range.
  const productMap = {};
  successInRange.forEach((o) => {
    const label = productLabel(o);
    if (!productMap[label]) productMap[label] = { label, revenue: 0, count: 0 };
    productMap[label].revenue += Number(o.amount || 0);
    productMap[label].count += 1;
  });
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topProductsMax = Math.max(1, ...topProducts.map((p) => p.revenue));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {RANGE_OPTIONS.map((r) => (
          <TabButton key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>{r.label}</TabButton>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 16 }}>
        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Revenue</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600 }}>GHS {revenue.toFixed(2)}</div></div>
        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Orders</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600 }}>{inRange.length}</div></div>
        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Payment success</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600, color: paymentSuccessRate < 90 && inRange.length > 0 ? "#dc2626" : undefined }}>{inRange.length ? `${paymentSuccessRate}%` : "—"}</div></div>\n        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Fulfillment success</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600, color: fulfillmentSuccessRate < 90 && paidInRange.length > 0 ? "#dc2626" : undefined }}>{paidInRange.length ? `${fulfillmentSuccessRate}%` : "—"}</div></div>
        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Avg order value</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600 }}>GHS {avgOrder.toFixed(2)}</div></div>
        <div className="stat-card"><div style={{ fontSize: 13, color: "var(--muted)" }}>Fees recovered</div><div className="heading-font" style={{ fontSize: 22, fontWeight: 600 }}>GHS {fees.toFixed(2)}</div></div>
      </div>

      {(failedInRange > 0 || pendingInRange > 0) && (
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          {failedInRange > 0 && <span style={{ color: "#dc2626", fontWeight: 600 }}>● {failedInRange} failed</span>}
          {pendingInRange > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}>● {pendingInRange} pending / processing</span>}
        </div>
      )}

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Revenue — last {trendDays} day{trendDays === 1 ? "" : "s"}
        </div>
        <BarChart points={trendPoints} valueFormatter={(v) => `GHS ${v.toFixed(2)}`} />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Top products ({rangeDef.label.toLowerCase()})</div>
        {topProducts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 16 }}>No successful orders in this range yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topProducts.map((p) => (
              <div key={p.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{p.label} <span style={{ color: "var(--muted-dim)" }}>· {p.count} order{p.count === 1 ? "" : "s"}</span></span>
                  <span style={{ fontWeight: 600 }}>GHS {p.revenue.toFixed(2)}</span>
                </div>
                <div style={{ background: "var(--surface-raised)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${(p.revenue / topProductsMax) * 100}%`, background: "var(--accent, #2563eb)", height: "100%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13, color: "var(--muted)" }}>
        <div>Open feedback: <strong style={{ color: "var(--text)" }}>{feedback.filter((f) => f.status === "open").length}</strong></div>
        <div>Needs attention: <strong style={{ color: "var(--text)" }}>{manualReview.length}</strong></div>
      </div>
    </div>
  );
}

function AuditLogTab({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No audit entries yet.</div>;
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {entries.map((e) => (
        <div key={e.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{e.action.replace(/_/g, " ")}</span>
            <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(e.createdAt).toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {e.actor}{e.reference ? ` · Ref ${e.reference}` : ""}{e.note ? ` · ${e.note}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReconciliationTab() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [generateAiSummary, setGenerateAiSummary] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function run() {
    if (!csvText) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/admin/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, generateAiSummary }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Reconciliation failed");
      setResult(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          In Paystack: Dashboard → Transactions → Export CSV. Upload that file here — it's matched exactly
          against your orders table (by reference, amount, and status). Nothing is sent anywhere except
          to Google, and only if you want the plain-English summary below.
        </p>
        <input type="file" accept=".csv" onChange={handleFile} />
        {fileName && <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: "8px 0 0" }}>Loaded: {fileName}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="primary-btn" onClick={run} disabled={!csvText || busy} style={{ width: "auto", padding: "8px 20px" }}>
            {busy ? "Reconciling…" : "Run reconciliation"}
          </button>
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>

      {result && (
        <>
          {result.summary && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>Summary</div>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{result.summary}</p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Matched</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--green)" }}>{result.counts.matched}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Mismatched</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--red)" }}>{result.counts.mismatched}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Paystack-only</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--red)" }}>{result.counts.paystackOnly}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>App-only</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--price)" }}>{result.counts.appOnly}</div></div>
          </div>

          {result.mismatched.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mismatched (amount or status disagree)</div>
              {result.mismatched.map((m) => (
                <div key={m.reference} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  {m.reference} — Paystack: GHS {m.paystackAmount} ({m.paystackStatus || "—"}) vs App: GHS {m.appAmount} ({m.appStatus})
                </div>
              ))}
            </div>
          )}

          {result.paystackOnly.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Paid on Paystack, no matching order</div>
              {result.paystackOnly.map((p) => (
                <div key={p.reference} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  {p.reference} — GHS {p.amount} ({p.status || "unknown status"})
                </div>
              ))}
            </div>
          )}

          {result.appOnly.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Marked paid in app, not found in this export</div>
              {result.appOnly.map((a) => (
                <div key={a.reference} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  {a.reference} — GHS {a.amount} ({a.orderType})
                </div>
              ))}
              <p style={{ fontSize: 11, color: "var(--muted-dim)", marginTop: 8, marginBottom: 0 }}>{result.note}</p>
            </div>
          )}

          {result.counts.mismatched === 0 && result.counts.paystackOnly === 0 && result.counts.appOnly === 0 && (
            <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--green)", fontSize: 14 }}>
              Everything matches — no discrepancies found.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [auth, setAuth] = useState(null);\n  const [role, setRole] = useState(null);
  const [orders, setOrders] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [manualReview, setManualReview] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [tab, setTab] = useState("overview");
  const [orderSearch, setOrderSearch] = useState("");
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletError, setWalletError] = useState(null);

  const canOperate = role === "operator" || role === "admin";

  async function load() {
    const results = await Promise.all([
      fetch("/api/orders/list"),
      fetch("/api/feedback/list"),
      fetch("/api/admin/audit-log"),
      fetch("/api/admin/reviews"),
      canOperate ? fetch("/api/orders/manual-review") : Promise.resolve(null),
    ]);
    const [ordersRes, feedbackRes, auditRes, reviewsRes, reviewRes] = results;
    if ([ordersRes, feedbackRes, auditRes, reviewsRes].some((r) => r.status === 401)) {
      setAuth(false);
      setRole(null);
      return;
    }
    const ordersData = await ordersRes.json();
    const feedbackData = await feedbackRes.json();
    const auditData = await auditRes.json();
    const reviewsData = await reviewsRes.json();
    const reviewData = reviewRes ? await reviewRes.json() : { orders: [] };
    setOrders(ordersData.orders || []);
    setFeedback(feedbackData.feedback || []);
    setManualReview(reviewData.orders || []);
    setAuditLog(auditData.entries || []);
    setReviews(reviewsData.reviews || []);
    setAuth(true);
  }

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => {
      setAuth(Boolean(d.authenticated));
      setRole(d.role || null);
    });
  }, []);
  useEffect(() => { if (auth && role) load(); }, [auth, role]);

  // Independent of the main load() above — a Techlink hiccup here shouldn't
  // break the rest of the dashboard. Re-checked every 2 minutes so a wallet
  // that runs dry mid-shift shows up without a manual refresh.
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    async function loadWallet() {
      try {
        const r = await fetch("/api/admin/wallet-balance");
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) { setWalletError(d.error || "Could not check wallet balance"); return; }
        if (d.balance == null) { setWalletError("Techlink responded in an unrecognized format — see server logs."); return; }
        setWalletBalance(d.balance);
        setWalletError(null);
      } catch {
        if (!cancelled) setWalletError("Could not reach Techlink");
      }
    }
    loadWallet();
    const interval = setInterval(loadWallet, 120000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [auth]);

  async function manualAction(reference, action) {
    const note = window.prompt(action === "confirm_fulfilled" ? "Confirm provider delivery and enter a brief note:" : "Confirm provider did not deliver and enter a brief note before retrying:");
    if (!note || note.trim().length < 5) return;
    const r = await fetch("/api/orders/manual-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, action, note }) });
    const d = await r.json();
    if (!r.ok) return window.alert(d.error || "Could not update the order");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuth(false);
  }

  if (auth === null) return null;
  if (!auth) return <PasswordGate onUnlock={({ role: nextRole }) => { setRole(nextRole); setAuth(true); }} />;

  const successfulOrders = orders.filter((o) => o.status === "success");
  // "Total sales" is deliberately the net product revenue (`amount`), not
  // what customers were charged at checkout — the Paystack fee markup is a
  // pass-through cost recovery, not real income, so it's broken out
  // separately below rather than inflating the headline sales number.
  const totalSales = successfulOrders.reduce((s, o) => s + Number(o.amount), 0);
  const totalFeesCollected = successfulOrders.reduce((s, o) => s + Number(o.paystackFeeAmount ?? 0), 0);

  const q = orderSearch.trim().toLowerCase();
  const filteredOrders = q
    ? orders.filter((o) => [o.reference, o.phone, o.email, o.orderType].some((v) => String(v || "").toLowerCase().includes(q)))
    : orders;

  const fq = feedbackSearch.trim().toLowerCase();
  const filteredFeedback = fq
    ? feedback.filter((f) => [f.caseReference, f.orderReference, f.name, f.email, f.phone].some((v) => String(v || "").toLowerCase().includes(fq)))
    : feedback;

  const LOW_WALLET_THRESHOLD = Number(process.env.NEXT_PUBLIC_TECHLINK_LOW_BALANCE_THRESHOLD || 200); // GHS — kept in sync with TECHLINK_LOW_BALANCE_THRESHOLD (server-side, used by the proactive email/SMS alert in lib/orderProcessing.js); change both together

  return (
    <div className="page-wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>Admin</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0, marginBottom: 24 }}>Secure admin session expires after 8 hours · Role: <strong style={{ color: "var(--text)" }}>{role || "—"}</strong></p>
        </div>
        <button className="nav-item" onClick={logout} style={{ width: "auto", padding: "6px 12px" }}>Sign out</button>
      </div>

      {walletError && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 14, color: "#92400e" }}>
          ⚠️ Couldn't check your Techlink wallet balance ({walletError}). Orders may be failing silently at fulfillment — worth checking Techlink directly.
        </div>
      )}
      {walletBalance != null && walletBalance < LOW_WALLET_THRESHOLD && (
        <div style={{ background: "#fee2e2", border: "1px solid #ef4444", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>
          🔴 Low Techlink wallet balance: GHS {walletBalance.toFixed(2)}. Customers can still pay via Paystack, but orders will start failing at fulfillment if this runs out — top up now.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Total sales</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>GHS {totalSales.toFixed(2)}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Paystack fees recovered</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>GHS {totalFeesCollected.toFixed(2)}</div></div>
        <div className="stat-card">
          <div style={{ fontSize: 14, color: "var(--muted)" }}>Techlink wallet</div>
          <div className="heading-font" style={{ fontSize: 24, fontWeight: 600, color: walletBalance != null && walletBalance < LOW_WALLET_THRESHOLD ? "#dc2626" : undefined }}>
            {walletBalance != null ? `GHS ${walletBalance.toFixed(2)}` : walletError ? "—" : "…"}
          </div>
        </div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Orders</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{orders.length}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Open feedback</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{feedback.filter((f) => f.status === "open").length}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Manual review</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{manualReview.length}</div></div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")}>Feedback</TabButton>
        {canOperate && <TabButton active={tab === "review"} onClick={() => setTab("review")}>Needs Attention ({manualReview.length})</TabButton>}
        {canOperate && <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")}>Reconciliation</TabButton>}
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>Reviews ({reviews.length})</TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>Audit Log</TabButton>
      </div>

      {tab === "overview" && (
        <>\n          <OverviewTab orders={orders} feedback={feedback} manualReview={manualReview} walletBalance={walletBalance} />\n          <div className="card" style={{ padding: 18, marginTop: 20 }}>\n            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Operations snapshot</div>\n            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, fontSize: 13 }}>\n              <div><span style={{ color: "var(--muted)" }}>Admin role</span><br /><strong>{role || "—"}</strong></div>\n              <div><span style={{ color: "var(--muted)" }}>Techlink wallet</span><br /><strong>{walletBalance != null ? `GHS ${Number(walletBalance).toFixed(2)}` : "Unavailable"}</strong></div>\n              <div><span style={{ color: "var(--muted)" }}>Manual review</span><br /><strong>{manualReview.length}</strong></div>\n              <div><span style={{ color: "var(--muted)" }}>Open feedback</span><br /><strong>{feedback.filter((f) => f.status === "open").length}</strong></div>\n            </div>\n            {canOperate && (manualReview.length > 0 || feedback.filter((f) => f.status === "open").length > 0 || walletError) && (\n              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 13 }}>\n                <strong>Needs attention:</strong> {manualReview.length > 0 ? `${manualReview.length} fulfillment item(s)` : ""}{manualReview.length > 0 && feedback.filter((f) => f.status === "open").length > 0 ? ", " : ""}{feedback.filter((f) => f.status === "open").length > 0 ? `${feedback.filter((f) => f.status === "open").length} open customer case(s)` : ""}{walletError ? `${manualReview.length || feedback.filter((f) => f.status === "open").length ? ", " : ""}Techlink wallet check unavailable` : ""}.\n              </div>\n            )}\n          </div>\n        </>
      )}

      {tab === "orders" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <SearchBox value={orderSearch} onChange={setOrderSearch} placeholder="Search by reference, phone, email, or type…" />
            <a href="/api/admin/export-orders" className="nav-item" style={{ width: "auto", padding: "8px 16px", textDecoration: "none" }}>
              Export CSV
            </a>
          </div>
          {orders.some((o) => o.fulfillmentStatus === "queued_with_provider") && (
            <div className="card" style={{ padding: 14, marginBottom: 12, borderColor: "var(--gold)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Queued with provider (normal for MTN Master, and for bulk orders awaiting your confirmation — not a failure)</div>
              {orders.filter((o) => o.fulfillmentStatus === "queued_with_provider").map((o) => (
                <div key={o.reference} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 12 }}>
                  <span>{o.reference} · GHS {Number(o.amount).toFixed(2)} · queued {new Date(o.createdAt).toLocaleString()}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="nav-item"
                      style={{ width: "auto", padding: "4px 10px" }}
                      onClick={async () => {
                        const r = await fetch("/api/admin/recheck-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: o.reference }) });
                        if (r.ok) load();
                        else window.alert((await r.json()).error || "Could not re-check this order");
                      }}
                    >
                      Re-check with Techlink
                    </button>
                    {/* Re-check only works when Techlink gave back an orderId to verify
                        against — bulk/Excel orders may not get one (the bulk response shape
                        isn't documented), so a bulk order can sit here with nothing to
                        auto-confirm it; since v1.3.1 you are alerted after QUEUED_ALERT_MINUTES. This is the manual
                        escape hatch: only usable after confirming delivery with Techlink
                        directly outside this app. */}
                    <button
                      className="nav-item"
                      style={{ width: "auto", padding: "4px 10px" }}
                      onClick={() => manualAction(o.reference, "confirm_fulfilled")}
                    >
                      Mark fulfilled manually
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <OrderList items={filteredOrders} />
        </div>
      )}

      {tab === "review" && canOperate && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 0", fontSize: 12, color: "var(--muted)" }}>
            Includes both orders escalated automatically and orders that failed immediately (e.g. an instant airtime top-up that couldn't be delivered) — the latter never promote themselves further without a scheduled job, so they're shown here directly.
          </div>
          {manualReview.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>Nothing needs attention right now.</div>}
          {manualReview.map((o) => (
            <div key={o.reference} className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <strong>{o.reference}</strong>
                <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(o.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                GHS {Number(o.amount).toFixed(2)} · {o.orderType} · {o.network || "service"}
                {o.orderType === "airtime" && <span style={{ color: "var(--red)", fontWeight: 600 }}> · instant — should not normally sit here</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>{o.lastFulfillmentError || "Provider outcome requires confirmation before any retry."}</div>
              <div style={{ fontSize: 12, color: "var(--price)" }}>Confirm the provider outcome before taking action. The buttons below create an admin audit note.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                <button className="nav-item" style={{ width: "auto", padding: "6px 10px" }} onClick={() => manualAction(o.reference, "confirm_fulfilled")}>Mark fulfilled</button>
                <button className="nav-item" style={{ width: "auto", padding: "6px 10px" }} onClick={() => manualAction(o.reference, "retry")}>Authorize retry</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "reconcile" && <ReconciliationTab />}

      {tab === "reviews" && (
        <div className="card" style={{ overflow: "hidden" }}>
          {reviews.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No reviews yet.</div>}
          {reviews.map((r) => (
            <div key={r.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, opacity: r.isHidden ? 0.5 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <strong style={{ fontSize: 14 }}>{r.customerName} — {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</strong>
                <button
                  className="nav-item"
                  style={{ width: "auto", padding: "4px 10px", fontSize: 12 }}
                  onClick={async () => {
                    const res = await fetch("/api/admin/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, isHidden: !r.isHidden }) });
                    if (res.ok) load();
                  }}
                >
                  {r.isHidden ? "Unhide" : "Hide"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Order {r.orderReference} · {r.serviceType} · {new Date(r.createdAt).toLocaleString()}</div>
              {r.comment && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.comment}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === "audit" && <AuditLogTab entries={auditLog} />}

      {tab === "feedback" && (
        <div>
          <SearchBox value={feedbackSearch} onChange={setFeedbackSearch} placeholder="Search by case, order ref, name, email, or phone…" />
          <div className="card" style={{ overflow: "hidden" }}>
            {filteredFeedback.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No feedback yet.</div>}
            {filteredFeedback.map((f) => (
              <div key={f.id} className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name} · <span style={{ color: "var(--muted)", fontWeight: 400 }}>{f.category}</span></span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {canOperate ? (                    <select
                      className="input"
                      style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                      value={f.status || "open"}
                      onChange={async (e) => {
                        const r = await fetch("/api/feedback/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, status: e.target.value }) });
                        if (r.ok) {
                          const d = await r.json();
                          setFeedback((prev) => prev.map((x) => (x.id === f.id ? d.feedback : x)));
                          load();
                        }
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                    </select>) : (\n                      <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{f.status || "open"}</span>\n                    )}
                    <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(f.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{f.message}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>
                  <div><strong>Case:</strong> {f.caseReference || "—"} {f.orderReference ? <>· <strong>Order:</strong> {f.orderReference}</> : null}</div>
                  <div><strong>Service:</strong> {f.serviceType || "—"} · <strong>Transaction ID:</strong> {f.transactionId || "—"} · <strong>Amount:</strong> {f.transactionAmount != null ? `GHS ${Number(f.transactionAmount).toFixed(2)}` : "—"}</div>
                  {f.requestedData ? <div><strong>Requested:</strong> {f.requestedData}</div> : null}
                  {f.beneficiary ? <div><strong>Beneficiary:</strong> {f.beneficiary}</div> : null}
                  {f.transactionAt ? <div><strong>Transaction time:</strong> {new Date(f.transactionAt).toLocaleString()}</div> : null}
                  <div><strong>Transaction details:</strong> {f.transactionDetails || "—"}</div>
                </div>
                {(f.email || f.phone) && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>{[f.email, f.phone].filter(Boolean).join(" · ")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
