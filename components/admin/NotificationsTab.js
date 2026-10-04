import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../lib/adminClient";
import { Banner, EmptyState } from "./AdminUi";

function queueTone(status) {
  if (status === "failed") return { label: "Failed", color: "var(--red)" };
  if (status === "processing") return { label: "Processing", color: "#b45309" };
  return { label: "Pending", color: "var(--muted)" };
}

export default function NotificationsTab({ refreshTick, onUnauthorized, onOpenAttention }) {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    adminApi("/api/admin/webhook-notifications", { onUnauthorized })
      .then((d) => { setNotifications(d.notifications || []); setError(""); })
      .catch((err) => setError(err.message));
  }, [onUnauthorized]);

  useEffect(() => { load(); }, [load, refreshTick]);

  return (
    <div>
      {error && <Banner tone="amber">{error}</Banner>}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>Paystack notifications waiting for settlement</strong>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>
          Read-only. Nothing here sends an order to Techlink. Use Needs attention to verify payment, inspect Techlink, or close an order.
        </p>
        {onOpenAttention && <button className="nav-item" onClick={onOpenAttention} style={{ width: "auto", padding: "6px 12px", marginTop: 10 }}>Open Needs attention</button>}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {notifications === null && !error && <EmptyState>Loading notifications…</EmptyState>}
        {notifications && notifications.length === 0 && <EmptyState>No open Paystack notifications.</EmptyState>}
        {(notifications || []).map((n) => {
          const q = queueTone(n.queueStatus);
          const attempts = Number(n.attempts || 0);
          return (
            <div key={n.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong>{n.orderNo || n.reference}</strong>
                <span style={{ fontSize: 12, color: q.color }}>
                  {q.label}{attempts ? " · " + attempts + " attempt" + (attempts === 1 ? "" : "s") : ""}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Ref {n.reference} · {n.orderType || "unknown service"}
                {n.expectedGhs != null ? " · expected GHS " + n.expectedGhs.toFixed(2) : ""}
                {n.paidGhs != null ? " · Paystack amount GHS " + n.paidGhs.toFixed(2) : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>
                Received {n.receivedAt ? new Date(n.receivedAt).toLocaleString() : "—"}
                {n.waitingMinutes != null ? " · waiting " + n.waitingMinutes + " min" : ""}
                {n.orderStatus ? " · order " + n.orderStatus : " · no matching order"}
                {n.fulfillmentStatus ? " · fulfillment " + n.fulfillmentStatus : ""}
              </div>
              {n.lastError && <div style={{ fontSize: 12, color: "var(--red)" }}>Last error: {n.lastError}</div>}
              {n.failReason && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Order issue: {n.failReason}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
