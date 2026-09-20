import { useEffect, useState } from "react";
import { OrderList } from "../../components/ui";

function PasswordGate({ onUnlock }) {
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
        body: JSON.stringify({ password: value }),
      });
      let data = {};
      try {
        data = await r.json();
      } catch {
        throw new Error(`Server error (${r.status}). Check the deployment logs.`);
      }
      if (!r.ok) throw new Error(data.error || "Login failed");
      onUnlock(true);
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
        body: JSON.stringify({ csv: csvText }),
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
  const [auth, setAuth] = useState(null);
  const [orders, setOrders] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [manualReview, setManualReview] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [tab, setTab] = useState("orders");
  const [orderSearch, setOrderSearch] = useState("");
  const [feedbackSearch, setFeedbackSearch] = useState("");

  async function load() {
    const [ordersRes, feedbackRes, reviewRes, auditRes] = await Promise.all([
      fetch("/api/orders/list"),
      fetch("/api/feedback/list"),
      fetch("/api/orders/manual-review"),
      fetch("/api/admin/audit-log"),
    ]);
    if ([ordersRes, feedbackRes, reviewRes, auditRes].some((r) => r.status === 401)) {
      setAuth(false);
      return;
    }
    const ordersData = await ordersRes.json();
    const feedbackData = await feedbackRes.json();
    const reviewData = await reviewRes.json();
    const auditData = await auditRes.json();
    setOrders(ordersData.orders || []);
    setFeedback(feedbackData.feedback || []);
    setManualReview(reviewData.orders || []);
    setAuditLog(auditData.entries || []);
    setAuth(true);
  }

  useEffect(() => { fetch("/api/admin/me").then((r) => r.json()).then((d) => setAuth(d.authenticated)); }, []);
  useEffect(() => { if (auth) load(); }, [auth]);

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
  if (!auth) return <PasswordGate onUnlock={() => setAuth(true)} />;

  const totalSales = orders.filter((o) => o.status === "success").reduce((s, o) => s + Number(o.amount), 0);

  const q = orderSearch.trim().toLowerCase();
  const filteredOrders = q
    ? orders.filter((o) => [o.reference, o.phone, o.email, o.orderType].some((v) => String(v || "").toLowerCase().includes(q)))
    : orders;

  const fq = feedbackSearch.trim().toLowerCase();
  const filteredFeedback = fq
    ? feedback.filter((f) => [f.caseReference, f.orderReference, f.name, f.email, f.phone].some((v) => String(v || "").toLowerCase().includes(fq)))
    : feedback;

  return (
    <div className="page-wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>Admin</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0, marginBottom: 24 }}>Secure admin session expires after 8 hours.</p>
        </div>
        <button className="nav-item" onClick={logout} style={{ width: "auto", padding: "6px 12px" }}>Sign out</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Total sales</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>GHS {totalSales.toFixed(2)}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Orders</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{orders.length}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Open feedback</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{feedback.filter((f) => f.status === "open").length}</div></div>
        <div className="stat-card"><div style={{ fontSize: 14, color: "var(--muted)" }}>Manual review</div><div className="heading-font" style={{ fontSize: 24, fontWeight: 600 }}>{manualReview.length}</div></div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")}>Feedback</TabButton>
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>Manual Review ({manualReview.length})</TabButton>
        <TabButton active={tab === "reconcile"} onClick={() => setTab("reconcile")}>Reconciliation</TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>Audit Log</TabButton>
      </div>

      {tab === "orders" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <SearchBox value={orderSearch} onChange={setOrderSearch} placeholder="Search by reference, phone, email, or type…" />
            <a href="/api/admin/export-orders" className="nav-item" style={{ width: "auto", padding: "8px 16px", textDecoration: "none" }}>
              Export CSV
            </a>
          </div>
          <OrderList items={filteredOrders} />
        </div>
      )}

      {tab === "review" && (
        <div className="card" style={{ overflow: "hidden" }}>
          {manualReview.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No orders currently require manual review.</div>}
          {manualReview.map((o) => (
            <div key={o.reference} className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}><strong>{o.reference}</strong><span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(o.createdAt).toLocaleString()}</span></div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>GHS {Number(o.amount).toFixed(2)} · {o.orderType} · {o.network || "service"}</div>
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
                    <select
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
                    </select>
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
