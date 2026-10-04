import { useState } from "react";
import { adminApi, ageText, ghs } from "../../lib/adminClient";
import { Banner, EmptyState, SearchBox } from "./AdminUi";

export default function FeedbackTab({ feedback = [], can, onChanged, onUnauthorized }) {
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
      onChanged?.();
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
                  <select name="status" aria-label="Case status" className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={f.status || "open"} onChange={(e) => setStatus(f, e.target.value)}>
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
