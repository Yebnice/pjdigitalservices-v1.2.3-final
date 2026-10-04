import { useState } from "react";
import { DataTable, EmptyState, MONO, TD } from "./AdminUi";
import { ghs } from "../../lib/adminClient";
import { toCsv, downloadCsv } from "../../lib/csv";

const money = (v) => (v == null ? "—" : ghs(v));

function Section({ title, help, count, tone, children }) {
  if (!count) return null;
  return (
    <div className="card" style={{ overflow: "hidden", borderColor: tone === "red" ? "#fca5a5" : undefined }}>
      <div style={{ padding: "12px 16px", background: tone === "red" ? "#fef2f2" : undefined }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({count})</span></div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{help}</div>
      </div>
      {children}
    </div>
  );
}

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
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await fetch("/api/admin/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csvText, generateAiSummary }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Reconciliation failed");
      setResult(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const rows = [
      ...result.mismatched.map((m) => ({ section: "Amount or status disagrees", reference: m.reference, paystackAmount: m.paystackAmount, appAmount: m.appAmount, difference: m.differenceGhs, paystackStatus: m.paystackStatus, appStatus: m.appStatus })),
      ...result.paystackOnly.map((p) => ({ section: "Paid on Paystack, no matching order", reference: p.reference, paystackAmount: p.amount, paystackStatus: p.status })),
      ...result.appOnly.map((a) => ({ section: "Marked paid in app, not in this export", reference: a.reference, appAmount: a.amount, appStatus: a.orderType })),
    ];
    downloadCsv(`reconciliation-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      { label: "Finding", key: "section" }, { label: "Reference", key: "reference" },
      { label: "Paystack amount (GHS)", key: "paystackAmount" }, { label: "App amount (GHS)", key: "appAmount" },
      { label: "Difference (GHS)", key: "difference" }, { label: "Paystack status", key: "paystackStatus" }, { label: "App status / type", key: "appStatus" },
    ], rows));
  }

  const c = result?.counts;
  const clean = c && c.mismatched === 0 && c.paystackOnly === 0 && c.appOnly === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          In Paystack: Dashboard → Transactions → Export CSV. Upload that file here. Every row is matched to your orders by reference, then compared in <strong>whole pesewas</strong> (amount) and status.
          Reconciliation runs inside the app; nothing is sent to Gemini unless you tick the optional summary.
        </p>
        <input id="reconcile-csv" name="reconcileCsv" aria-label="Paystack transactions CSV" type="file" accept=".csv" onChange={handleFile} />
        {fileName && <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: "8px 0 0" }}>Loaded: {fileName}</p>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <input type="checkbox" name="generateAiSummary" checked={generateAiSummary} onChange={(e) => setGenerateAiSummary(e.target.checked)} />
          Generate optional AI summary (sends the computed reconciliation result to Gemini)
        </label>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="primary-btn" onClick={run} disabled={!csvText || busy} style={{ width: "auto", padding: "8px 20px" }}>{busy ? "Reconciling…" : "Run reconciliation"}</button>
          {result && <button className="nav-item" onClick={exportCsv} style={{ width: "auto", padding: "8px 16px" }}>Export findings (CSV)</button>}
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
          <div className="card" style={{ overflow: "hidden" }}>
            <DataTable columns={[{ key: "m", label: "Matched" }, { key: "x", label: "Amount or status disagrees" }, { key: "p", label: "Paystack only" }, { key: "a", label: "App only" }]} minWidth={560}>
              <tr>
                <td style={{ ...TD, fontSize: 20, fontWeight: 700, color: "var(--green)" }}>{c.matched}</td>
                <td style={{ ...TD, fontSize: 20, fontWeight: 700, color: c.mismatched ? "var(--red)" : undefined }}>{c.mismatched}</td>
                <td style={{ ...TD, fontSize: 20, fontWeight: 700, color: c.paystackOnly ? "var(--red)" : undefined }}>{c.paystackOnly}</td>
                <td style={{ ...TD, fontSize: 20, fontWeight: 700 }}>{c.appOnly}</td>
              </tr>
            </DataTable>
          </div>
          {clean && <div className="card"><EmptyState>Everything matches. No discrepancies found.</EmptyState></div>}

          <Section tone="red" title="Amount or status disagrees" count={result.mismatched.length} help="The same reference exists on both sides but the money or the outcome differs. A difference of even one pesewa is shown.">
            <DataTable columns={[{ key: "r", label: "Reference" }, { key: "pa", label: "Paystack amount", align: "right" }, { key: "aa", label: "App amount", align: "right" }, { key: "d", label: "Difference", align: "right" }, { key: "ps", label: "Paystack status" }, { key: "as", label: "App status" }]} minWidth={760}>
              {result.mismatched.map((m) => (
                <tr key={m.reference}>
                  <td style={TD}><span style={MONO}>{m.reference}</span></td>
                  <td style={{ ...TD, textAlign: "right" }}>{money(m.paystackAmount)}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{money(m.appAmount)}</td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 600, color: m.differenceGhs ? "var(--red)" : undefined }}>{m.differenceGhs == null ? "—" : `${m.differenceGhs > 0 ? "+" : ""}${m.differenceGhs.toFixed(2)}`}</td>
                  <td style={TD}>{m.paystackStatus || "—"}</td>
                  <td style={TD}>{m.appStatus || "—"}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          <Section tone="red" title="Paid on Paystack, no matching order" count={result.paystackOnly.length} help="Money arrived but no order carries this reference. Find the customer before anything else.">
            <DataTable columns={[{ key: "r", label: "Reference" }, { key: "a", label: "Amount", align: "right" }, { key: "s", label: "Paystack status" }]} minWidth={520}>
              {result.paystackOnly.map((p) => (
                <tr key={p.reference}><td style={TD}><span style={MONO}>{p.reference}</span></td><td style={{ ...TD, textAlign: "right" }}>{money(p.amount)}</td><td style={TD}>{p.status || "unknown"}</td></tr>
              ))}
            </DataTable>
          </Section>

          <Section title="Marked paid in app, not found in this export" count={result.appOnly.length} help={result.note || "Check the export covers the same dates as these orders."}>
            <DataTable columns={[{ key: "r", label: "Reference" }, { key: "a", label: "Amount", align: "right" }, { key: "t", label: "Order type" }]} minWidth={520}>
              {result.appOnly.map((a) => (
                <tr key={a.reference}><td style={TD}><span style={MONO}>{a.reference}</span></td><td style={{ ...TD, textAlign: "right" }}>{money(a.amount)}</td><td style={TD}>{a.orderType}</td></tr>
              ))}
            </DataTable>
          </Section>
        </>
      )}
    </div>
  );
}
