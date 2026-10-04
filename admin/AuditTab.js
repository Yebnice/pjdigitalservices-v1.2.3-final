import { useMemo, useState } from "react";
import { DataTable, EmptyState, MONO, SearchBox, TD } from "./AdminUi";
import { TONE_COLORS, whenText, ageText } from "../../lib/adminClient";
import { toCsv, downloadCsv } from "../../lib/csv";

// Things worth noticing at a glance. Red = something was blocked or looks wrong;
// amber = a person spent money or changed a control.
const ALERT_ACTIONS = ["admin_login_failed", "delivery_blocked_by_policy", "techlink_test_mode_response", "voucher_details_missing", "admin_approve_delivery_refused"];
const ALERT_PREFIXES = ["payment_blocked_", "paystack_dispute_"];
const MONEY_ACTIONS = ["manual_review_confirm_fulfilled", "admin_process_now", "admin_verify_and_process", "admin_approve_delivery", "orders_exported", "manual_review_retry", "admin_changed_delivery_mode", "admin_mark_paid_send", "paystack_refund_processed"];

const isAlert = (action) => ALERT_ACTIONS.includes(action) || ALERT_PREFIXES.some((p) => String(action).startsWith(p));

function toneOf(action) {
  if (isAlert(action)) return TONE_COLORS.red;
  if (MONEY_ACTIONS.includes(action)) return TONE_COLORS.amber;
  return undefined;
}

const COLUMNS = [
  { key: "when", label: "When (UTC)" },
  { key: "actor", label: "Who" },
  { key: "action", label: "Action" },
  { key: "order", label: "Order" },
  { key: "note", label: "Details" },
];

export default function AuditTab({ entries }) {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const actions = useMemo(() => [...new Set((entries || []).map((e) => e.action))].sort(), [entries]);
  const needle = q.trim().toLowerCase();
  const shown = (entries || []).filter((e) =>
    (!action || e.action === action) &&
    (!needle || [e.actor, e.action, e.reference, e.note].some((v) => String(v || "").toLowerCase().includes(needle))));
  const failedLogins = (entries || []).filter((e) => e.action === "admin_login_failed").length;
  const alerts = (entries || []).filter((e) => isAlert(e.action) && e.action !== "admin_login_failed").length;

  function exportCsv() {
    const csv = toCsv([
      { label: "Time (UTC)", value: (e) => e.createdAt },
      { label: "Who", key: "actor" },
      { label: "Action", key: "action" },
      { label: "Order reference", key: "reference" },
      { label: "Details", key: "note" },
    ], shown);
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search who, action, order or details…" style={{ flex: 1, minWidth: 220 }} />
        <select name="action" aria-label="Filter by action" className="input" style={{ width: "auto" }} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
        <button className="nav-item" style={{ width: "auto", padding: "8px 14px" }} onClick={exportCsv} disabled={!shown.length}>Export these {shown.length} rows (CSV)</button>
      </div>
      {(failedLogins > 0 || alerts > 0) && (
        <div style={{ fontSize: 13, color: TONE_COLORS.red, marginBottom: 8 }}>
          {failedLogins > 0 ? `● ${failedLogins} failed sign-in attempt${failedLogins === 1 ? "" : "s"} in this window. ` : ""}
          {alerts > 0 ? `● ${alerts} alert event${alerts === 1 ? "" : "s"}: a payment, delivery or provider response the app refused, or a dispute.` : ""}
        </div>
      )}
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 && <EmptyState>{entries?.length ? "No entries match." : "No audit entries yet."}</EmptyState>}
        {shown.length > 0 && (
          <DataTable columns={COLUMNS} minWidth={900}>
            {shown.map((e) => (
              <tr key={e.id}>
                <td style={{ ...TD, whiteSpace: "nowrap" }}>{whenText(e.createdAt)}<div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{ageText(e.createdAt)} ago</div></td>
                <td style={TD}>{e.actor}</td>
                <td style={{ ...TD, fontWeight: 600, color: toneOf(e.action) }}>{String(e.action).replace(/_/g, " ")}</td>
                <td style={TD}>{e.reference ? <span style={MONO}>{e.reference}</span> : "—"}</td>
                <td style={{ ...TD, color: "var(--muted)", maxWidth: 420, wordBreak: "break-word" }}>{e.note || "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}
