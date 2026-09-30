import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, ageText, ghs } from "../../lib/adminClient";
import { Banner, EmptyState, NoteDialog, SearchBox, StatCard, TabButton } from "../../components/admin/AdminUi";
import OverviewTab from "../../components/admin/OverviewTab";
import OrdersTab from "../../components/admin/OrdersTab";
import AttentionTab from "../../components/admin/AttentionTab";
import AuditTab from "../../components/admin/AuditTab";

const REFRESH_MS = 60000;
// Techlink wallet warning level (GHS). Keep in sync with the server-side
// TECHLINK_LOW_BALANCE_THRESHOLD used by the email/SMS alert in lib/orderProcessing.js.
const LOW_WALLET_THRESHOLD = Number(process.env.NEXT_PUBLIC_TECHLINK_LOW_BALANCE_THRESHOLD || 200);

const ACTION_COPY = {
  confirm_fulfilled: { title: "Mark this order as delivered", message: "Only do this after you have confirmed with Techlink that it was delivered. The customer will be emailed/texted that it arrived.", confirmLabel: "Mark delivered", danger: true },
  retry: { title: "Authorise a retry", message: "Confirm that Techlink did NOT deliver this order. A retry sends it to Techlink again.", confirmLabel: "Authorise retry", danger: true },
  process_now: { title: "Send to Techlink now", message: "This order is paid and verified but has not been sent to Techlink yet.", confirmLabel: "Send now" },
  verify_and_process: { title: "Verify payment and process", message: "Paystack is re-checked first. Techlink is only called if Paystack confirms the exact amount.", confirmLabel: "Verify & process" },
};

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
      onUnlock();
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
          against your orders table (by reference, amount, and status). Exact reconciliation runs inside the app. No transaction-level results are sent to Gemini unless you explicitly enable the optional AI summary.
        </p>
        <input type="file" accept=".csv" onChange={handleFile} />
        {fileName && <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: "8px 0 0" }}>Loaded: {fileName}</p>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <input type="checkbox" checked={generateAiSummary} onChange={(e) => setGenerateAiSummary(e.target.checked)} />
          Generate optional AI summary (sends the computed reconciliation result to Gemini)
        </label>
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

function FeedbackTab({ feedback, can, onChanged, onUnauthorized }) {
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? feedback.filter((f) => [f.caseReference, f.orderReference, f.name, f.email, f.phone].some((v) => String(v || "").toLowerCase().includes(needle)))
    : feedback;

  async function setStatus(f, status) {
    setError("");
    try {
      await adminApi("/api/feedback/status", { method: "POST", body: { id: f.id, status }, onUnauthorized });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search by case, order ref, name, email, or phone…" style={{ marginBottom: 12 }} />
      {error && <Banner tone="amber">{error}</Banner>}
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 && <EmptyState>No feedback yet.</EmptyState>}
        {shown.map((f) => (
          <div key={f.id} className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name} · <span style={{ color: "var(--muted)", fontWeight: 400 }}>{f.category}</span></span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {can("feedback.update") ? (
                  <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={f.status || "open"} onChange={(e) => setStatus(f, e.target.value)}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{f.status || "open"}</span>
                )}
                <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{ageText(f.createdAt)} ago</span>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{f.message}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>
              <div><strong>Case:</strong> {f.caseReference || "—"} {f.orderReference ? <>· <strong>Order:</strong> {f.orderReference}</> : null}</div>
              <div><strong>Service:</strong> {f.serviceType || "—"} · <strong>Transaction ID:</strong> {f.transactionId || "—"} · <strong>Amount:</strong> {f.transactionAmount != null ? ghs(f.transactionAmount) : "—"}</div>
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
  );
}

function ReviewsTab({ can, refreshTick, onUnauthorized }) {
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    adminApi("/api/admin/reviews", { onUnauthorized }).then((d) => { setReviews(d.reviews || []); setError(""); }).catch((err) => setError(err.message));
  }, [onUnauthorized]);
  useEffect(() => { load(); }, [load, refreshTick]);

  async function toggle(r) {
    try {
      await adminApi("/api/admin/reviews", { method: "POST", body: { id: r.id, isHidden: !r.isHidden }, onUnauthorized });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <Banner tone="amber">{error}</Banner>}
      <div className="card" style={{ overflow: "hidden" }}>
        {reviews && reviews.length === 0 && <EmptyState>No reviews yet.</EmptyState>}
        {!reviews && !error && <EmptyState>Loading reviews…</EmptyState>}
        {(reviews || []).map((r) => (
          <div key={r.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, opacity: r.isHidden ? 0.5 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <strong style={{ fontSize: 14 }}>{r.customerName} — {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</strong>
              {can("reviews.moderate") && (
                <button className="nav-item" style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} onClick={() => toggle(r)}>{r.isHidden ? "Unhide" : "Hide"}</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Order {r.orderReference} · {r.serviceType} · {new Date(r.createdAt).toLocaleString()}</div>
            {r.comment && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.comment}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [auth, setAuth] = useState(null);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState("7d");
  const [overview, setOverview] = useState(null);
  const [manualReview, setManualReview] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [walletBalance, setWalletBalance] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [actionBusy, setActionBusy] = useState({});
  const [dialog, setDialog] = useState(null); // { order, action }
  const [notice, setNotice] = useState("");
  const loadId = useRef(0);

  const can = useCallback((permission) => Boolean(me?.permissions?.includes(permission)), [me]);
  const onUnauthorized = useCallback(() => { setAuth(false); setMe(null); }, []);

  const loadMe = useCallback(async () => {
    try {
      const d = await fetch("/api/admin/me", { cache: "no-store" }).then((r) => r.json());
      setAuth(Boolean(d.authenticated));
      setMe(d.authenticated ? d : null);
    } catch {
      setAuth(false);
    }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  // One refresh cycle. Each section loads independently and a failure only
  // marks THAT section: the old dashboard turned any failed request into an
  // empty list, so an outage looked like "no sales, nothing wrong".
  const refreshAll = useCallback(async () => {
    if (!me) return;
    const id = ++loadId.current;
    setLoadingOverview(true);
    const jobs = {
      overview: can("overview.view") ? adminApi(`/api/admin/overview?range=${range}`, { onUnauthorized }) : null,
      review: can("orders.process") ? adminApi("/api/orders/manual-review", { onUnauthorized }) : null,
      feedback: can("feedback.view") ? adminApi("/api/feedback/list", { onUnauthorized }) : null,
      wallet: can("wallet.view") ? adminApi("/api/admin/wallet-balance", { onUnauthorized }) : null,
      audit: can("audit.view") ? adminApi("/api/admin/audit-log", { onUnauthorized }) : null,
    };
    const keys = Object.keys(jobs);
    const settled = await Promise.allSettled(keys.map((k) => jobs[k] || Promise.resolve(undefined)));
    if (id !== loadId.current) return; // a newer refresh has started
    const nextErrors = {};
    settled.forEach((res, i) => {
      const key = keys[i];
      if (!jobs[key]) return;
      if (res.status === "rejected") { nextErrors[key] = res.reason?.message || "failed"; return; }
      const d = res.value;
      if (key === "overview") setOverview(d);
      if (key === "review") setManualReview(d.orders || []);
      if (key === "feedback") setFeedback(d.feedback || []);
      if (key === "audit") setAuditLog(d.entries || []);
      if (key === "wallet") {
        if (d.balance == null) nextErrors.wallet = "Techlink responded in an unrecognized format — see server logs.";
        else setWalletBalance(d.balance);
      }
    });
    setErrors(nextErrors);
    setLoadingOverview(false);
    setLastUpdated(new Date());
    setRefreshTick((t) => t + 1);
  }, [me, range, can, onUnauthorized]);

  useEffect(() => { if (auth && me) refreshAll(); }, [auth, me, range, refreshAll]);

  // Auto-refresh every minute, and straight away when the tab becomes visible
  // again, so a dashboard left open all day never shows stale numbers.
  useEffect(() => {
    if (!auth || !me) return undefined;
    const tick = () => { if (!document.hidden) refreshAll(); };
    const interval = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [auth, me, refreshAll]);

  async function runAction(order, action, note) {
    const key = `${order.reference}:${action}`;
    setActionBusy((prev) => ({ ...prev, [key]: true }));
    setNotice("");
    try {
      if (action === "recheck") {
        await adminApi("/api/admin/recheck-order", { method: "POST", body: { reference: order.reference }, onUnauthorized });
      } else {
        await adminApi("/api/orders/manual-review", { method: "POST", body: { reference: order.reference, action, note }, onUnauthorized });
      }
      setNotice(`Done: ${order.reference}`);
      await refreshAll();
    } catch (err) {
      if (err.status !== 401) window.alert(err.message);
    } finally {
      setActionBusy((prev) => { const next = { ...prev }; delete next[key]; return next; });
    }
  }

  function requestAction(order, action) {
    if (action === "recheck") return runAction(order, action);
    setDialog({ order, action });
  }

  async function logout() {
    try { await fetch("/api/admin/logout", { method: "POST" }); } finally { setAuth(false); setMe(null); }
  }

  if (auth === null) return null;
  if (!auth) return <PasswordGate onUnlock={loadMe} />;

  const openFeedback = feedback.filter((f) => f.status === "open" || !f.status).length;
  const oldestAttention = manualReview.reduce((min, o) => (o.createdAt && (min == null || new Date(o.createdAt) < min) ? new Date(o.createdAt) : min), null);
  const walletLow = walletBalance != null && walletBalance < LOW_WALLET_THRESHOLD;
  const dialogCopy = dialog ? ACTION_COPY[dialog.action] : null;
  // Only sign-in failures from the last 24 hours, so an old burst does not nag forever.
  const failedLogins = auditLog.filter((e) => e.action === "admin_login_failed" && Date.now() - new Date(e.createdAt).getTime() < 24 * 3600 * 1000).length;

  return (
    <div className="page-wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>Admin</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0, marginBottom: 16 }}>
            Signed in as <strong style={{ color: "var(--text)" }}>{me?.username}</strong> ({me?.role}) · session ends after 8 hours
            {lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="nav-item" onClick={refreshAll} style={{ width: "auto", padding: "6px 12px" }} disabled={loadingOverview}>{loadingOverview ? "Refreshing…" : "Refresh"}</button>
          <button className="nav-item" onClick={logout} style={{ width: "auto", padding: "6px 12px" }}>Sign out</button>
        </div>
      </div>

      {notice && <Banner tone="blue">{notice}</Banner>}
      {walletLow && <Banner tone="red"><strong>Low Techlink wallet: {ghs(walletBalance)}.</strong> Customers can still pay through Paystack, but orders will start failing at delivery if it runs out. Top up now.</Banner>}
      {errors.wallet && <Banner tone="amber">Couldn't check the Techlink wallet ({errors.wallet}). Orders may be failing at delivery without warning — check Techlink directly.</Banner>}
      {manualReview.length > 0 && can("orders.process") && (
        <Banner tone="red" action={<button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={() => setTab("review")}>Open</button>}>
          <strong>{manualReview.length} order{manualReview.length === 1 ? "" : "s"} need attention</strong>{oldestAttention ? ` — oldest waiting ${ageText(oldestAttention.toISOString())}` : ""}.
        </Banner>
      )}
      {failedLogins >= 3 && <Banner tone="amber">{failedLogins} failed admin sign-in attempts in the last 24 hours (see the audit log). If that wasn't you, change your admin password and ADMIN_SESSION_SECRET.</Banner>}
      {Object.entries(errors).filter(([k]) => !["wallet", "overview"].includes(k)).map(([k, msg]) => (
        <Banner key={k} tone="amber">Couldn't refresh {k === "review" ? "needs-attention orders" : k === "audit" ? "the audit log" : k} ({msg}). What you see for that section may be out of date.</Banner>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 20 }}>
        {can("wallet.view") && <StatCard label="Techlink wallet" value={walletBalance != null ? ghs(walletBalance) : errors.wallet ? "—" : "…"} tone={walletLow ? "red" : undefined} />}
        {can("orders.process") && <StatCard label="Needs attention" value={manualReview.length} tone={manualReview.length ? "red" : undefined} hint={oldestAttention ? `oldest ${ageText(oldestAttention.toISOString())}` : "all clear"} />}
        {overview && <StatCard label="Paid, not delivered" value={overview.atRisk.count} tone={overview.atRisk.count ? "red" : undefined} hint={overview.atRisk.count ? ghs(overview.atRisk.value) : "none waiting"} />}
        <StatCard label="Open feedback" value={openFeedback} tone={openFeedback ? "amber" : undefined} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
        {can("orders.process") && <TabButton active={tab === "review"} onClick={() => setTab("review")} badge={manualReview.length || null}>Needs attention</TabButton>}
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")} badge={openFeedback || null}>Feedback</TabButton>
        {can("reconcile.run") && <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")}>Reconciliation</TabButton>}
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>Reviews</TabButton>
        {can("audit.view") && <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>Audit log</TabButton>}
      </div>

      {tab === "overview" && <OverviewTab overview={overview} loading={loadingOverview} error={errors.overview} range={range} onRangeChange={setRange} />}
      {tab === "orders" && <OrdersTab can={can} refreshTick={refreshTick} onUnauthorized={onUnauthorized} />}
      {tab === "review" && can("orders.process") && <AttentionTab orders={manualReview} can={can} busy={actionBusy} onAction={requestAction} />}
      {tab === "feedback" && <FeedbackTab feedback={feedback} can={can} onChanged={refreshAll} onUnauthorized={onUnauthorized} />}
      {tab === "reconcile" && can("reconcile.run") && <ReconciliationTab />}
      {tab === "reviews" && <ReviewsTab can={can} refreshTick={refreshTick} onUnauthorized={onUnauthorized} />}
      {tab === "audit" && can("audit.view") && <AuditTab entries={auditLog} />}

      <NoteDialog
        open={Boolean(dialog)}
        title={dialogCopy ? `${dialogCopy.title} — ${dialog.order.reference}` : ""}
        message={dialogCopy?.message}
        confirmLabel={dialogCopy?.confirmLabel}
        danger={dialogCopy?.danger}
        onCancel={() => setDialog(null)}
        onConfirm={(note) => { const { order, action } = dialog; setDialog(null); runAction(order, action, note); }}
      />
    </div>
  );
}
