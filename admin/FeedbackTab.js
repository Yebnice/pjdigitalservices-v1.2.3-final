import { useState } from "react";
import { Banner, DataTable, EmptyState, KeyValueTable, MONO, SearchBox, TD } from "./AdminUi";
import { adminApi, ageText, ghs, whenText } from "../../lib/adminClient";
import { toCsv, downloadCsv } from "../../lib/csv";

const COLUMNS = [
  { key: "case", label: "Case" },
  { key: "when", label: "Received" },
  { key: "who", label: "Customer" },
  { key: "about", label: "About" },
  { key: "order", label: "Order" },
  { key: "msg", label: "Message" },
  { key: "status", label: "Status" },
  { key: "open", label: "", align: "right", width: 80 },
];

export default function FeedbackTab({ feedback, can, onChanged, onUnauthorized }) {
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
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

  function exportCsv() {
    downloadCsv(`feedback-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      { label: "Case", key: "caseReference" }, { label: "Received", key: "createdAt" }, { label: "Name", key: "name" }, { label: "Email", key: "email" },
      { label: "Phone", key: "phone" }, { label: "Category", key: "category" }, { label: "Service", key: "serviceType" }, { label: "Order", key: "orderReference" },
      { label: "Amount (GHS)", key: "transactionAmount" }, { label: "Status", value: (f) => f.status || "open" }, { label: "Message", key: "message" },
    ], shown));
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search case, order number, name, email or phone…" style={{ flex: 1, minWidth: 220 }} />
        <button className="nav-item" style={{ width: "auto", padding: "8px 14px" }} onClick={exportCsv} disabled={!shown.length}>Export (CSV)</button>
      </div>
      {error && <Banner tone="amber">{error}</Banner>}
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 && <EmptyState>No feedback yet.</EmptyState>}
        {shown.length > 0 && (
          <DataTable columns={COLUMNS} minWidth={1020}>
            {shown.map((f) => {
              const open = openId === f.id;
              return [
                <tr key={f.id} style={{ background: open ? "var(--surface-raised)" : undefined }}>
                  <td style={TD}><span style={MONO}>{f.caseReference || "—"}</span></td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>{whenText(f.createdAt)}<div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{ageText(f.createdAt)} ago</div></td>
                  <td style={TD}><strong>{f.name}</strong><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{[f.email, f.phone].filter(Boolean).join(" · ") || "—"}</div></td>
                  <td style={TD}>{f.category}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.serviceType || "—"}</div></td>
                  <td style={TD}>{f.orderReference ? <span style={MONO}>{f.orderReference}</span> : "—"}</td>
                  <td style={{ ...TD, maxWidth: 320, wordBreak: "break-word", color: "var(--muted)" }}>{f.message}</td>
                  <td style={TD}>
                    {can("feedback.update") ? (
                      <select name="status" aria-label="Case status" className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={f.status || "open"} onChange={(e) => setStatus(f, e.target.value)}>
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    ) : <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{f.status || "open"}</span>}
                  </td>
                  <td style={{ ...TD, textAlign: "right" }}><button className="nav-item" style={{ width: "auto", padding: "3px 9px", fontSize: 12 }} onClick={() => setOpenId(open ? null : f.id)}>{open ? "Hide" : "Details"}</button></td>
                </tr>,
                open && (
                  <tr key={`${f.id}-d`}>
                    <td colSpan={COLUMNS.length} style={{ padding: "14px 16px", background: "var(--surface-raised)", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 22 }}>
                        <KeyValueTable title="Transaction" rows={[
                          ["Service", f.serviceType], ["Transaction ID", f.transactionId, { mono: true }],
                          ["Amount", f.transactionAmount != null ? ghs(f.transactionAmount) : null],
                          ["Transaction time", f.transactionAt ? whenText(f.transactionAt) : null],
                          ["Requested", f.requestedData], ["Beneficiary", f.beneficiary],
                        ]} />
                        <KeyValueTable title="Customer's description" rows={[["Details", f.transactionDetails], ["Message", f.message]]} />
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </DataTable>
        )}
      </div>
    </div>
  );
}
