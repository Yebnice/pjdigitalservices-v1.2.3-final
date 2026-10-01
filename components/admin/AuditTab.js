import { useMemo, useState } from "react";
import { EmptyState, SearchBox } from "./AdminUi";
import { TONE_COLORS } from "../../lib/adminClient";

// Actions worth noticing at a glance.
const ALERT_ACTIONS = ["admin_login_failed"];
const MONEY_ACTIONS = ["manual_review_confirm_fulfilled", "admin_process_now", "admin_verify_and_process", "orders_exported", "manual_review_retry"];

export default function AuditTab({ entries }) {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const actions = useMemo(() => [...new Set((entries || []).map((e) => e.action))].sort(), [entries]);
  const needle = q.trim().toLowerCase();
  const shown = (entries || []).filter((e) =>
    (!action || e.action === action) &&
    (!needle || [e.actor, e.action, e.reference, e.note].some((v) => String(v || "").toLowerCase().includes(needle))));
  const failedLogins = (entries || []).filter((e) => e.action === "admin_login_failed").length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search actor, reference or note…" style={{ flex: 1, minWidth: 220 }} />
        <select name="action" aria-label="Filter by action" className="input" style={{ width: "auto" }} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      {failedLogins > 0 && (
        <div style={{ fontSize: 13, color: TONE_COLORS.red, marginBottom: 8 }}>● {failedLogins} failed sign-in attempt{failedLogins === 1 ? "" : "s"} in this window.</div>
      )}
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 && <EmptyState>{entries?.length ? "No entries match." : "No audit entries yet."}</EmptyState>}
        {shown.map((e) => (
          <div key={e.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: ALERT_ACTIONS.includes(e.action) ? TONE_COLORS.red : MONEY_ACTIONS.includes(e.action) ? TONE_COLORS.amber : undefined }}>{e.action.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(e.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.actor}{e.reference ? ` · Ref ${e.reference}` : ""}{e.note ? ` · ${e.note}` : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
