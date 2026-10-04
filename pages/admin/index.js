import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, ageText, ghs } from "../../lib/adminClient";
import { Banner, EmptyState, NoteDialog, SearchBox, StatCard, TabButton } from "../../components/admin/AdminUi";
import OverviewTab from "../../components/admin/OverviewTab";
import OrdersTab from "../../components/admin/OrdersTab";
import AttentionTab from "../../components/admin/AttentionTab";
import AuditTab from "../../components/admin/AuditTab";
import ReconcileTab from "../../components/admin/ReconcileTab";
import NotificationsTab from "../../components/admin/NotificationsTab";
import FeedbackTab from "../../components/admin/FeedbackTab";
import ReviewsTab from "../../components/admin/ReviewsTab";

const REFRESH_MS = 60000;
// Techlink wallet warning level (GHS). Keep in sync with the server-side
// TECHLINK_LOW_BALANCE_THRESHOLD used by the email/SMS alert in lib/orderProcessing.js.
const LOW_WALLET_THRESHOLD = Number(process.env.NEXT_PUBLIC_TECHLINK_LOW_BALANCE_THRESHOLD || 200);

const ACTION_COPY = {
  confirm_fulfilled: { title: "Mark this order as delivered", message: "Only do this after you have confirmed with Techlink that it was delivered. The customer will be emailed/texted that it arrived.", confirmLabel: "Mark delivered", danger: true },
  retry: { title: "Authorise a retry and send", message: "Confirm that Techlink did NOT deliver this order. Your authorisation sends it to Techlink now.", confirmLabel: "Authorise & send", danger: true },
  process_now: { title: "Send to Techlink now", message: "This order is paid and verified but has not been sent to Techlink yet.", confirmLabel: "Send now" },
  verify_and_process: { title: "Verify with Paystack", message: "Asks Paystack about this checkout and records the answer. Nothing is sent to Techlink. If it was paid, it moves to “Paid — awaiting your approval”.", confirmLabel: "Verify (no delivery)" },
  approve_delivery: { title: "Approve & deliver", message: "Paystack is re-checked right now (live payment, exact amount, this reference) and Techlink's history is checked so it is not delivered twice. If both are fine, this order is sent to Techlink and wallet money is spent. Your name is recorded.", warning: "This spends Techlink wallet balance. Only approve an order you have looked at.", confirmLabel: "Approve & deliver", danger: true },
  confirm_from_techlink: { title: "Close: Techlink shows this delivered", message: "The server re-checks Techlink's order history and only closes the order if it really shows it as delivered. The customer is told it arrived.", confirmLabel: "Confirm delivered" },
  accept_charged: { title: "Accept this payment and send the order", message: "The customer paid at least the order price but the amount did not match exactly. Paystack is re-checked; if it is fine, the order is sent to Techlink now.", confirmLabel: "Accept & send" },
  mark_delivered: { title: "Mark this order as delivered", message: "You are confirming the customer HAS received it (or that you delivered it yourself). The order is closed as delivered and counted in your sales.", warning: "If this order was never paid, marking it delivered also records it as paid. Only do that if you have confirmed the payment yourself (for example in the Paystack dashboard).", confirmLabel: "Mark delivered", danger: true, options: [{ key: "notifyCustomer", label: "Tell the customer it was delivered (email / SMS)", defaultChecked: true }] },
  mark_resolved: { title: "Mark this issue as resolved", message: "Closes the order WITHOUT delivering it: for example the customer was refunded, the checkout was abandoned, or you settled it another way. It is removed from Needs attention and is not counted as a sale.", confirmLabel: "Mark resolved" },
  mark_paid_send: { title: "Mark as paid and send to Techlink", message: "You are confirming you have verified the customer's payment yourself. The order is marked paid and sent to Techlink now, which spends wallet balance. The server first checks Techlink's history so it does not deliver twice.", warning: "Only use this when Paystack's own check cannot confirm a payment you know was made.", confirmLabel: "Mark paid & send", danger: true },
  close_charged: { title: "Close this charged order", message: "Use this only after you have refunded the customer or otherwise dealt with it outside the app. Nothing will be sent.", confirmLabel: "Close order", danger: true },
};

function PasswordGate({ onUnlock }) {
  const [username, setUsername] = useState("admin");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function tryUnlock() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: value, code: code.replace(/\s+/g, "") }),
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
        <input id="admin-username" name="username" aria-label="Admin username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin username" autoComplete="username" style={{ marginBottom: 12 }} />
        <input id="admin-password" name="password" aria-label="Admin password" className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && tryUnlock()} placeholder="Admin password" autoComplete="current-password" />
        <input id="admin-code" name="otp" aria-label="Authenticator code" className="input" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, "").slice(0, 7))} onKeyDown={(e) => e.key === "Enter" && tryUnlock()} placeholder="6-digit authenticator code" inputMode="numeric" autoComplete="one-time-code" />
        <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: "-4px 0 0" }}>Enter the code from your authenticator app. Leave it blank only if two-factor is not set up for your account.</p>
        <button className="primary-btn" onClick={tryUnlock} disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
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
  const [attentionCounts, setAttentionCounts] = useState(null);
  const [attentionTruncated, setAttentionTruncated] = useState(false);
  const [health, setHealth] = useState(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [checks, setChecks] = useState({});
  const [payments, setPayments] = useState({});
  const [workerBusy, setWorkerBusy] = useState(false);
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
      health: can("system.view") ? adminApi("/api/admin/health", { onUnauthorized }) : null,
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
      if (key === "review") { setManualReview(d.orders || []); setAttentionCounts(d.counts || null); setAttentionTruncated(Boolean(d.truncated)); }
      if (key === "health") setHealth(d);
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

  async function runAction(order, action, note, opts = {}) {
    const key = `${order.reference}:${action}`;
    setActionBusy((prev) => ({ ...prev, [key]: true }));
    setNotice("");
    let forceAgain = false;
    try {
      if (action === "recheck") {
        await adminApi("/api/admin/recheck-order", { method: "POST", body: { reference: order.reference }, onUnauthorized });
      } else {
        await adminApi("/api/orders/manual-review", { method: "POST", body: { reference: order.reference, action, note, ...(opts.force ? { force: true } : {}), ...(opts.notifyCustomer === false ? { notifyCustomer: false } : {}) }, onUnauthorized });
      }
      setNotice(`Done: ${order.reference}`);
      await refreshAll();
    } catch (err) {
      if (err.status === 409 && err.data?.canForce && window.confirm(`${err.message}\n\nForce it anyway?`)) forceAgain = true;
      else if (err.status !== 401) window.alert(err.message);
    } finally {
      setActionBusy((prev) => { const next = { ...prev }; delete next[key]; return next; });
    }
    // Outside the try/finally so the busy flag of the second attempt is not cleared by the first.
    if (forceAgain) await runAction(order, action, note, { ...opts, force: true });
  }

  function requestAction(order, action, opts = {}) {
    if (action === "recheck") return runAction(order, action);
    setDialog({ order, action, opts });
  }

  async function checkTechlink(order) {
    setChecks((prev) => ({ ...prev, [order.reference]: { loading: true } }));
    try {
      const d = await adminApi(`/api/admin/techlink-check?reference=${encodeURIComponent(order.reference)}`, { onUnauthorized });
      setChecks((prev) => ({ ...prev, [order.reference]: { evidence: d.evidence } }));
    } catch (err) {
      setChecks((prev) => ({ ...prev, [order.reference]: { error: err.message } }));
    }
  }

  async function inspectPayment(order) {
    setPayments((prev) => ({ ...prev, [order.reference]: { loading: true } }));
    try {
      const d = await adminApi(`/api/admin/payment-check?reference=${encodeURIComponent(order.reference)}`, { onUnauthorized });
      setPayments((prev) => ({ ...prev, [order.reference]: { payment: d } }));
    } catch (err) {
      setPayments((prev) => ({ ...prev, [order.reference]: { error: err.message } }));
    }
  }

  // "Check outstanding orders": asks Paystack about old unpaid checkouts and
  // reports what needs a decision. It can never deliver (the server enforces it).
  async function runWorker() {
    setWorkerBusy(true);
    setNotice("");
    try {
      const d = await adminApi("/api/admin/run-worker", { method: "POST", onUnauthorized });
      const parts = [`checked ${d.checked ?? 0} unpaid checkout(s)`];
      if (d.webhooksRecorded) parts.push(`recorded ${d.webhooksRecorded} Paystack payment notification(s)`);
      if (d.paidHeld) parts.push(`${d.paidHeld} paid and now waiting for your approval`);
      if (d.closed) parts.push(`${d.closed} closed as abandoned`);
      if (d.stillPending) parts.push(`${d.stillPending} still open at Paystack`);
      if (d.rejected) parts.push(`${d.rejected} rejected (see Needs attention)`);
      if (d.failures?.length) parts.push(`${d.failures.length} problem(s): ${d.failures.map((f) => f.error || f.step).join("; ")}`);
      setNotice(`Check complete: ${parts.join("; ")}. Deliveries: 0. Needs attention now: ${d.needsAttentionTotal ?? 0}.`);
      await refreshAll();
    } catch (err) {
      if (err.status !== 401) window.alert(err.message);
    } finally {
      setWorkerBusy(false);
    }
  }

  async function changeDeliveryMode(next) {
    const text = next === "manual"
      ? "Switch to MANUAL delivery?\n\nEvery paid order will wait in Needs attention until you approve it. Customers will see “Payment received — under review”."
      : "Switch back to AUTOMATIC delivery?\n\nFresh, live-verified payments will be sent to Techlink straight away. Old, unverified or test payments are still held for your approval.";
    if (!window.confirm(text)) return;
    setModeBusy(true);
    try {
      await adminApi("/api/admin/delivery-mode", { method: "POST", body: { mode: next }, onUnauthorized });
      setNotice(`Delivery mode is now ${next.toUpperCase()}.`);
      await refreshAll();
    } catch (err) {
      if (err.status !== 401) window.alert(err.message);
    } finally {
      setModeBusy(false);
    }
  }

  async function logout() {
    try { await fetch("/api/admin/logout", { method: "POST" }); } finally { setAuth(false); setMe(null); }
  }

  if (auth === null) return null;
  if (!auth) return <PasswordGate onUnlock={loadMe} />;

  const openFeedback = feedback.filter((f) => f.status === "open" || !f.status).length;
  const paidNeedingAction = attentionCounts?.paidNeedingAction ?? manualReview.length;
  const unpaidCount = attentionCounts?.unpaid ?? 0;
  const workerStale = health && (health.worker.lastRunAt == null || health.worker.ageMinutes > 20);
  const webhookStuck = health?.webhooks && !health.webhooks.error && health.webhooks.pending > 0 && health.webhooks.oldestPendingAt && (Date.now() - new Date(health.webhooks.oldestPendingAt).getTime()) > 15 * 60000;
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
          {can("worker.run") && <button className="nav-item" onClick={runWorker} style={{ width: "auto", padding: "6px 12px" }} disabled={workerBusy} title="Asks Paystack about old unpaid checkouts and lists what needs a decision. Sends nothing to Techlink.">{workerBusy ? "Checking…" : "Check outstanding orders"}</button>}
          <button className="nav-item" onClick={refreshAll} style={{ width: "auto", padding: "6px 12px" }} disabled={loadingOverview}>{loadingOverview ? "Refreshing…" : "Refresh"}</button>
          <button className="nav-item" onClick={logout} style={{ width: "auto", padding: "6px 12px" }}>Sign out</button>
        </div>
      </div>

      {notice && <Banner tone="blue">{notice}</Banner>}
      {me?.mode === "shared" && (
        <Banner tone="amber"><strong>Everyone who uses this login is recorded as "admin".</strong> If more than one person has access, give each person their own account so the audit log shows who did what: run <code>npm run admin:user</code> and put the result in <code>ADMIN_USERS_JSON</code> (see DEPLOYMENT.md).</Banner>
      )}
      {me && !me.twoFactor && me.role === "admin" && (
        <Banner tone="blue">Two-factor sign-in is <strong>off</strong> for this account. Anyone who learns the password can open this dashboard and move money. {me.mode === "shared" ? "Set ADMIN_TOTP_SECRET" : "Add a totpSecret to your account"} (generate one with <code>npm run admin:user</code>) and set <code>ADMIN_REQUIRE_2FA=true</code> to make it mandatory.</Banner>
      )}
      {health?.paystack?.keyMode === "test" && health.paystack.strict && (
        <Banner tone="red"><strong>This site is using a Paystack TEST key.</strong> Test payments move no money, so every order is being blocked from delivery. Set the LIVE secret key (sk_live_…) in your hosting environment variables, then redeploy.</Banner>
      )}
      {health?.reversals?.last30d > 0 && (
        <Banner tone="amber"><strong>{health.reversals.last30d} Paystack refund/dispute notice(s) in the last 30 days.</strong> They change what your books should say, and a dispute may have a deadline. Open the Audit tab (look for “paystack_refund” and “paystack_dispute”) and check each in the Paystack dashboard.</Banner>
      )}
      {health?.rateLimit?.backend === "memory" && (
        <Banner tone="amber"><strong>Login and API rate limits are per-server, not shared.</strong> No Redis is configured, so on Vercel each server instance counts separately and a determined attacker can slip past the login throttle. Add an Upstash Redis integration (KV_REST_API_URL and KV_REST_API_TOKEN) in Vercel to fix this.</Banner>
      )}
      {health?.techlink?.keyMode === "test" && health.techlink.strict && (
        <Banner tone="red"><strong>This site is using a Techlink TEST key.</strong> Nothing is being sent to Techlink, and paid orders are waiting. Set TECHLINK_API_KEY to your live key (it starts tlg_live_) in your hosting environment variables and redeploy; the waiting orders then deliver on their own.</Banner>
      )}
      {(health?.techlink?.keyMode === "missing" || health?.techlink?.keyMode === "unknown") && (
        <Banner tone="amber"><strong>The Techlink API key is {health.techlink.keyMode === "missing" ? "missing" : "not recognised"}</strong> (it should start tlg_live_). Check TECHLINK_API_KEY in your hosting environment variables.</Banner>
      )}
      {health?.paystack?.keyMode === "unknown" && (
        <Banner tone="amber"><strong>The Paystack secret key is not recognised</strong> (it should start with sk_live_). Check PAYSTACK_SECRET_KEY in your hosting environment variables.</Banner>
      )}
      {health?.delivery && (
        <Banner tone={health.delivery.mode === "manual" ? "amber" : "blue"} action={me?.role === "admin" ? <button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} disabled={modeBusy} onClick={() => changeDeliveryMode(health.delivery.mode === "manual" ? "automatic" : "manual")}>{modeBusy ? "Saving…" : health.delivery.mode === "manual" ? "Switch to automatic" : "Switch to manual"}</button> : null}>
          <strong>Delivery mode: {health.delivery.mode === "manual" ? "MANUAL" : "AUTOMATIC"}.</strong>{" "}
          {health.delivery.mode === "manual"
            ? "Every paid order waits in Needs attention for your approval."
            : `Fresh, live-verified payments (under ${health.delivery.autoMaxAgeMinutes} min old) are delivered at once. Anything older, found by a check, or not live-verified waits for your approval.`}
          {health.delivery.known === false ? " (Could not read the saved setting, so deliveries are held.)" : ""}
        </Banner>
      )}
      {walletLow && <Banner tone="red"><strong>Low Techlink wallet: {ghs(walletBalance)}.</strong> Customers can still pay through Paystack, but orders will start failing at delivery if it runs out. Top up now.</Banner>}
      {errors.wallet && <Banner tone="amber">Couldn't check the Techlink wallet ({errors.wallet}). Orders may be failing at delivery without warning — check Techlink directly.</Banner>}
      {workerStale && (
        <Banner tone="red" action={can("worker.run") ? <button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} disabled={workerBusy} onClick={runWorker}>{workerBusy ? "Checking…" : "Check outstanding orders"}</button> : null}>
          <strong>{health.worker.lastRunAt ? `The background worker last ran ${ageText(health.worker.lastRunAt)} ago.` : "The background worker has not reported in yet."}</strong> While it is not running, customers who paid may not be getting their orders. Check the GitHub Actions tab (scheduled workflows are switched off after 60 days without repository activity) and the CRON_SECRET secret.
        </Banner>
      )}
      {health?.worker?.lastRunOk === false && !workerStale && <Banner tone="amber">The last worker run had problems in: {health.worker.failedSteps.join(", ") || "unknown steps"}. See Vercel logs.</Banner>}
      {webhookStuck && <Banner tone="red" action={<button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={() => setTab("notifications")}>Open table</button>}>{health.webhooks.pending} Paystack payment notification(s) are waiting, the oldest for {ageText(health.webhooks.oldestPendingAt)}. Nothing is sent to Techlink from here: open the table, then decide each one on the Needs attention tab.</Banner>}
      {health?.webhooks && !health.webhooks.error && health.webhooks.failed > 0 && <Banner tone="amber">{health.webhooks.failed} Paystack payment notification(s) failed permanently. Those customers may have paid without being delivered: check the Needs attention tab.</Banner>}
      {paidNeedingAction > 0 && can("orders.process") && (
        <Banner tone="red" action={<button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={() => setTab("review")}>Open</button>}>
          <strong>{paidNeedingAction} paid order{paidNeedingAction === 1 ? "" : "s"} need{paidNeedingAction === 1 ? "s" : ""} a decision</strong>{attentionCounts?.charged_rejected ? ` — including ${attentionCounts.charged_rejected} where the customer was charged but nothing was delivered` : ""}.
        </Banner>
      )}
      {failedLogins >= 3 && <Banner tone="amber">{failedLogins} failed admin sign-in attempts in the last 24 hours (see the audit log). If that wasn't you, change your admin password and ADMIN_SESSION_SECRET.</Banner>}
      {Object.entries(errors).filter(([k]) => !["wallet", "overview", "health"].includes(k)).map(([k, msg]) => (
        <Banner key={k} tone="amber">Couldn't refresh {k === "review" ? "needs-attention orders" : k === "audit" ? "the audit log" : k} ({msg}). What you see for that section may be out of date.</Banner>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 20 }}>
        {can("wallet.view") && <StatCard label="Techlink wallet" value={walletBalance != null ? ghs(walletBalance) : errors.wallet ? "—" : "…"} tone={walletLow ? "red" : undefined} />}
        {can("orders.process") && <StatCard label="Paid — need a decision" value={paidNeedingAction} tone={paidNeedingAction ? "red" : undefined} hint={attentionCounts?.held ? `${attentionCounts.held} awaiting your approval` : unpaidCount ? `+ ${unpaidCount} unpaid checkouts` : "all clear"} />}
        {overview && <StatCard label="Paid, not delivered" value={overview.atRisk.count} tone={overview.atRisk.count ? "red" : undefined} hint={overview.atRisk.count ? ghs(overview.atRisk.value) : "none waiting"} />}
        <StatCard label="Open feedback" value={openFeedback} tone={openFeedback ? "amber" : undefined} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
        {can("orders.process") && <TabButton active={tab === "review"} onClick={() => setTab("review")} badge={paidNeedingAction || null}>Needs attention</TabButton>}
        {can("system.view") && <TabButton active={tab === "notifications"} onClick={() => setTab("notifications")} badge={(health?.webhooks && !health.webhooks.error ? health.webhooks.pending + health.webhooks.failed : 0) || null}>Paystack notifications</TabButton>}
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")} badge={openFeedback || null}>Feedback</TabButton>
        {can("reconcile.run") && <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")}>Reconciliation</TabButton>}
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>Reviews</TabButton>
        {can("audit.view") && <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>Audit log</TabButton>}
      </div>

      {tab === "overview" && <OverviewTab overview={overview} loading={loadingOverview} error={errors.overview} range={range} onRangeChange={setRange} />}
      {tab === "orders" && <OrdersTab can={can} refreshTick={refreshTick} onUnauthorized={onUnauthorized} />}
      {tab === "review" && can("orders.process") && <AttentionTab orders={manualReview} counts={attentionCounts} truncated={attentionTruncated} can={can} busy={actionBusy} checks={checks} payments={payments} onAction={requestAction} onCheck={checkTechlink} onInspect={inspectPayment} onRunWorker={runWorker} workerBusy={workerBusy} />}
      {tab === "notifications" && can("system.view") && <NotificationsTab refreshTick={refreshTick} onUnauthorized={onUnauthorized} onOpenAttention={() => setTab("review")} />}
      {tab === "feedback" && <FeedbackTab feedback={feedback} can={can} onChanged={refreshAll} onUnauthorized={onUnauthorized} />}
      {tab === "reconcile" && can("reconcile.run") && <ReconcileTab />}
      {tab === "reviews" && <ReviewsTab can={can} refreshTick={refreshTick} onUnauthorized={onUnauthorized} />}
      {tab === "audit" && can("audit.view") && <AuditTab entries={auditLog} />}

      <NoteDialog
        open={Boolean(dialog)}
        title={dialogCopy ? `${dialogCopy.title} — ${dialog.order.reference}` : ""}
        message={dialogCopy?.message}
        warning={dialogCopy?.warning}
        options={dialogCopy?.options || []}
        confirmLabel={dialogCopy?.confirmLabel}
        danger={dialogCopy?.danger}
        onCancel={() => setDialog(null)}
        onConfirm={(note, picked) => { const { order, action, opts } = dialog; setDialog(null); runAction(order, action, note, { ...opts, ...picked }); }}
      />
    </div>
  );
}
