import { ageText, ghs, orderStatusBadge } from "../../lib/adminClient";
import { EmptyState, StatusPill } from "./AdminUi";

// What each stuck order needs, in plain words, and which actions are safe.
function describe(o) {
  const queued = o.fulfillmentStatus === "queued_with_provider";
  const ready = o.status === "payment_verified" && o.fulfillmentStatus === "ready";
  const unverified = ["pending", "payment_pending"].includes(o.status);
  const retryable = ["manual_review", "failed"].includes(o.fulfillmentStatus);
  return { queued, ready, unverified, retryable };
}

function ActionButton({ busy, busyText, children, onClick, disabled, title }) {
  return (
    <button className="nav-item" style={{ width: "auto", padding: "6px 10px" }} disabled={busy || disabled} title={title} onClick={onClick}>
      {busy ? busyText : children}
    </button>
  );
}

export default function AttentionTab({ orders, can, busy, onAction }) {
  // Oldest first: the customer who has waited longest is at the top.
  const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const isBusy = (ref, action) => Boolean(busy[`${ref}:${action}`]);
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 0", fontSize: 12, color: "var(--muted)" }}>
        Orders that need a person: escalated automatically, failed delivery, queued with Techlink, or paid but not yet sent. Oldest first.
      </div>
      {sorted.length === 0 && <EmptyState>Nothing needs attention right now. 🎉</EmptyState>}
      {sorted.map((o) => {
        const { queued, ready, unverified, retryable } = describe(o);
        const badge = orderStatusBadge(o);
        const waitingLong = (Date.now() - new Date(o.createdAt).getTime()) > 60 * 60000;
        return (
          <div key={o.reference} className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{o.reference} <StatusPill text={badge.text} tone={badge.tone} /></strong>
              <span style={{ fontSize: 12, color: waitingLong ? "#dc2626" : "var(--muted-dim)", fontWeight: waitingLong ? 600 : 400 }}>waiting {ageText(o.createdAt)} · {new Date(o.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {ghs(o.checkoutAmount ?? o.amount)} · {o.orderType} · {o.network || "service"} · {o.phone}
              {o.status === "payment_verified" && <span style={{ color: "var(--green)", fontWeight: 600 }}> · payment verified</span>}
            </div>
            {queued && o.result?.orderId && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Techlink order ID: {String(o.result.orderId)}</div>}
            {ready && <div style={{ fontSize: 12, color: "var(--price)" }}>Payment is verified but the order has not been sent to Techlink yet. You can send it now without waiting for the scheduler.</div>}
            {unverified && <div style={{ fontSize: 12, color: "var(--price)" }}>Not yet verified as paid. The button re-checks Paystack first; Techlink is only called if Paystack confirms the exact amount.</div>}
            {queued && <div style={{ fontSize: 12, color: "var(--price)" }}>Techlink accepted this order. Confirm delivery with Techlink before marking it delivered. Never retry a queued or bulk order.</div>}
            {retryable && <div style={{ fontSize: 12, color: "var(--price)" }}>Only authorise a retry after you have established that the previous Techlink attempt did NOT deliver.</div>}
            {o.lastFulfillmentError && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Last error: {o.lastFulfillmentError}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {unverified && <ActionButton busy={isBusy(o.reference, "verify_and_process")} busyText="Verifying…" onClick={() => onAction(o, "verify_and_process")}>Verify payment &amp; process</ActionButton>}
              {ready && <ActionButton busy={isBusy(o.reference, "process_now")} busyText="Sending to Techlink…" onClick={() => onAction(o, "process_now")}>Process with Techlink</ActionButton>}
              {queued && o.result?.orderId && <ActionButton busy={isBusy(o.reference, "recheck")} busyText="Checking…" onClick={() => onAction(o, "recheck")}>Re-check with Techlink</ActionButton>}
              {(queued || retryable) && (
                can("orders.confirm_fulfilled")
                  ? <ActionButton busy={isBusy(o.reference, "confirm_fulfilled")} busyText="Updating…" onClick={() => onAction(o, "confirm_fulfilled")}>Mark delivered</ActionButton>
                  : <ActionButton disabled title="Marking an order delivered tells the customer it arrived, so only an admin can do it" onClick={() => {}}>Mark delivered (admin only)</ActionButton>
              )}
              {retryable && <ActionButton busy={isBusy(o.reference, "retry")} busyText="Authorising…" onClick={() => onAction(o, "retry")}>Authorise retry</ActionButton>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
