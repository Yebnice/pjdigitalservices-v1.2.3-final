import { useEffect, useState, useCallback } from "react";
import { DataTable, EmptyState, MONO, TD } from "./AdminUi";
import { ghs } from "../../lib/adminClient";
import { toCsv, downloadCsv } from "../../lib/csv";

const COLUMNS = ["Received", "Waiting", "Reference", "Order no.", "Order status", "Expected", "Queue", "What to do"].map((label) => ({ label }));
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const waiting = (m) => (m == null ? "—" : m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);
const money = (v) => (v == null ? "—" : ghs(v));

// What the admin should DO with each row. Nothing on this tab sends anything to Techlink.
function nextStep(n) {
  if (!n.hasOrder) return "No matching order. Check the reference in Paystack.";
  if (n.fulfilled) return "Already delivered. Nothing to do.";
  if (n.fulfillmentStatus === "manual_review") return "Paid and held. Decide on the Needs attention tab.";
  if (n.queueStatus === "failed") return "Could not be processed. Check Paystack, then decide on the Needs attention tab.";
  return "Waiting. Use Check outstanding orders to record it, then decide on the Needs attention tab.";
}

export default function NotificationsTab({ refreshTick, onUnauthorized, onOpenAttention }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/admin/webhook-notifications");
      if (r.status === 401) { onUnauthorized?.(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load");
      setRows(d.notifications || []);
    } catch (err) {
      setError(err.message);
    }
  }, [onUnauthorized]);

  useEffect(() => { load(); }, [load, refreshTick]);

  function exportCsv() {
    downloadCsv(`paystack-notifications-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      { label: "Received", key: "receivedAt" }, { label: "Waiting (min)", key: "waitingMinutes" }, { label: "Reference", key: "reference" },
      { label: "Order no.", key: "orderNo" }, { label: "Order status", key: "orderStatus" }, { label: "Fulfilment", key: "fulfillmentStatus" },
      { label: "Expected GHS", key: "expectedGhs" }, { label: "Queue status", key: "queueStatus" }, { label: "Attempts", key: "attempts" }, { label: "Last error", key: "lastError" },
    ], rows || []));
  }

  if (error) return <div className="card" style={{ padding: 16, color: "#b91c1c" }}>{error}</div>;
  if (!rows) return <div className="card" style={{ padding: 16 }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Paystack payment notifications waiting <span style={{ fontWeight: 400, color: "var(--muted)" }}>({rows.length})</span></div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          Fresh payments are verified with Paystack and delivered at once. Anything that waited too long, or could not be settled, is listed here and is never sent to Techlink by a background run: you decide.
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={load}>Refresh</button>
          {rows.length > 0 && <button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={exportCsv}>Export CSV</button>}
          {onOpenAttention && <button className="nav-item" style={{ width: "auto", padding: "4px 10px" }} onClick={onOpenAttention}>Open Needs attention</button>}
        </div>
      </div>
      {rows.length === 0 ? <EmptyState>No Paystack notifications are waiting.</EmptyState> : (
        <div className="card" style={{ overflow: "hidden" }}>
          <DataTable columns={COLUMNS} minWidth={980}>
            {rows.map((n) => (
              <tr key={n.id}>
                <td style={{ ...TD, whiteSpace: "nowrap" }}>{when(n.receivedAt)}</td>
                <td style={{ ...TD, whiteSpace: "nowrap" }}>{waiting(n.waitingMinutes)}</td>
                <td style={TD}><span style={MONO}>{n.reference}</span></td>
                <td style={TD}>{n.orderNo ? <span style={MONO}>{n.orderNo}</span> : "—"}</td>
                <td style={TD}>{n.hasOrder ? `${n.orderStatus || "—"} / ${n.fulfillmentStatus || "—"}${n.failReason ? ` (${n.failReason})` : ""}` : "no order"}</td>
                <td style={TD}>{money(n.expectedGhs)}</td>
                <td style={{ ...TD, wordBreak: "break-word", maxWidth: 260 }}>{n.queueStatus}{n.attempts ? ` · ${n.attempts} try` : ""}{n.lastError ? ` · ${n.lastError}` : ""}</td>
                <td style={{ ...TD, color: "var(--muted)", maxWidth: 260 }}>{nextStep(n)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
