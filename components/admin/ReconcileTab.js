import { useState } from "react";

export default function ReconcileTab() {
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
          In Paystack: Dashboard → Transactions → Export CSV. Upload that file here. The server matches it against the order records by reference, amount, and status.
          Exact reconciliation stays inside the app; only the precomputed totals are sent to Gemini when you explicitly enable the optional summary.
        </p>
        <input id="reconcile-csv" name="reconcileCsv" aria-label="Paystack transactions CSV" type="file" accept=".csv" onChange={handleFile} />
        {fileName && <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: "8px 0 0" }}>Loaded: {fileName}</p>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <input type="checkbox" name="generateAiSummary" checked={generateAiSummary} onChange={(e) => setGenerateAiSummary(e.target.checked)} />
          Generate optional AI summary
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Matched</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--green)" }}>{result.counts.matched}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Mismatched</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--red)" }}>{result.counts.mismatched}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>Paystack-only</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--red)" }}>{result.counts.paystackOnly}</div></div>
            <div className="stat-card"><div style={{ fontSize: 12, color: "var(--muted)" }}>App-only</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--price)" }}>{result.counts.appOnly}</div></div>
          </div>

          {result.mismatched.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mismatched</div>
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
