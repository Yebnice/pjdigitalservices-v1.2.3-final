import { useState } from "react";
import { ageText, ghs, orderStatusBadge } from "../../lib/adminClient";
import { EmptyState, StatusPill } from "./AdminUi";

const SECTION_HELP = {
  charged_rejected: "Paystack took the customer's money but the payment did not match the order, so nothing was sent. Inspect what Paystack took, then either accept it and send the order, or refund the customer and close it.",
  paid: "The customer's payment is confirmed. Before you retry or mark anything, press “Check Techlink”: it looks in Techlink's own order history so you don't have to guess whether it was already delivered. The Manual control row lets an admin settle any order by hand when the checks cannot.",
  unpaid: "No payment was ever confirmed for these. Most are people who closed the payment window. “Run worker now” asks Paystack about every one: paid ones are delivered, abandoned ones are closed.",
};

const VERDICT = {
  delivered: { text: "Techlink shows this order as DELIVERED", color: "#16a34a" },
  in_progress: { text: "Techlink has this order and is still processing it", color: "#b45309" },
  failed_at_provider: { text: "Techlink shows this order FAILED — safe to retry", color: "#16a34a" },
  not_found: { text: "Techlink has NO record of this order — it was never delivered", color: "#16a34a" },
  unknown: { text: "Could not confirm either way", color: "#b45309" },
  not_checkable: { text: "Several recipients — cannot be matched automatically", color: "#b45309" },
};

function Btn({ children, onClick, busy, busyText, disabled, title, danger }) {
  return (
    <button className="nav-item" style={{ width: "auto", padding: "6px 10px", ...(danger ? { borderColor: "#dc2626", color: "#991b1b" } : null) }} disabled={busy || disabled} title={title} onClick={onClick}>
      {busy ? busyText : children}
    </button>
  );
}

function EvidenceBox({ state }) {
  if (!state) return null;
  if (state.loading) return <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Checking Techlink's order history…</div>;
  if (state.error) return <div style={{ fontSize: 12, color: "#b45309" }}>Could not check ({state.error}).</div>;
  const ev = state.evidence;
  if (!ev) return null;
  const v = VERDICT[ev.verdict] || VERDICT.unknown;
  return (
    <div style={{ fontSize: 12, borderLeft: `3px solid ${v.color}`, paddingLeft: 10, margin: "4px 0" }}>
      <div style={{ fontWeight: 700, color: v.color }}>{v.text}</div>
      <div style={{ color: "var(--muted)" }}>{ev.note}</div>
      {(ev.matches || []).map((m, i) => (
        <div key={`${m.orderId}-${i}`} style={{ color: "var(--muted-dim)" }}>• {m.orderId || "order"} · {m.status || "status unknown"}{m.amount != null ? ` · GHS ${Number(m.amount).toFixed(2)}` : ""}{m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString()}` : ""}</div>
      ))}
    </div>
  );
}

function PaymentBox({ state }) {
  if (!state) return null;
  if (state.loading) return <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Asking Paystack…</div>;
  if (state.error) return <div style={{ fontSize: 12, color: "#b45309" }}>Could not check ({state.error}).</div>;
  const p = state.payment;
  if (!p) return null;
  const good = p.verdict === "acceptable";
  const text = { acceptable: "Paid in full or more — safe to accept and send.", underpaid: `Underpaid by GHS ${Math.abs(p.difference).toFixed(2)} — cannot be sent. Refund it or collect the difference.`, wrong_currency: "Not paid in GHS.", not_paid: "Paystack does not show this payment as successful." }[p.verdict] || p.verdict;
  return (
    <div style={{ fontSize: 12, borderLeft: `3px solid ${good ? "#16a34a" : "#dc2626"}`, paddingLeft: 10, margin: "4px 0" }}>
      <div style={{ fontWeight: 700, color: good ? "#16a34a" : "#dc2626" }}>Paystack took GHS {p.paid.toFixed(2)} · order costs GHS {p.expected.toFixed(2)}</div>
      <div style={{ color: "var(--muted)" }}>{text}</div>
    </div>
  );
}

function OrderCard({ o, can, busy, checks, payments, onAction, onCheck, onInspect }) {
  const isBusy = (action) => Boolean(busy[`${o.reference}:${action}`]);
  const badge = orderStatusBadge(o);
  const cat = o.category;
  const waitingLong = (Date.now() - new Date(o.createdAt).getTime()) > 60 * 60000;
  const ev = checks[o.reference]?.evidence;
  const verdict = ev?.verdict;
  const evidenceSaysDelivered = verdict === "delivered";
  const retryBlocked = verdict === "delivered" || verdict === "in_progress";
  const paidCategory = ["ready", "queued", "retryable"].includes(cat);

  return (
    <div className="tx-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{o.reference} <StatusPill text={badge.text} tone={badge.tone} /></strong>
        <span style={{ fontSize: 12, color: waitingLong ? "#dc2626" : "var(--muted-dim)", fontWeight: waitingLong ? 600 : 400 }}>waiting {ageText(o.createdAt)} · {new Date(o.createdAt).toLocaleString()}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        {ghs(o.checkoutAmount ?? o.amount)} · {o.orderType} · {o.network || "service"} · {o.phone}{o.email ? ` · ${o.email}` : ""}
      </div>
      {cat === "charged_rejected" && (
        <div style={{ fontSize: 12, color: "#991b1b" }}>Rejected: {o.failReason === "currency_mismatch" ? "wrong currency" : "amount did not match"}{o.paymentAmountGhs != null ? ` — Paystack recorded GHS ${o.paymentAmountGhs.toFixed(2)}` : ""}.</div>
      )}
      {cat === "queued" && o.result?.orderId && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Techlink order ID: {String(o.result.orderId)}</div>}
      {o.lastFulfillmentError && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Last error: {o.lastFulfillmentError}</div>}

      <EvidenceBox state={checks[o.reference]} />
      <PaymentBox state={payments[o.reference]} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {cat === "charged_rejected" && (
          <>
            <Btn busy={payments[o.reference]?.loading} busyText="Checking…" onClick={() => onInspect(o)}>Inspect what Paystack took</Btn>
            {can("orders.accept_charged")
              ? <Btn disabled={payments[o.reference]?.payment?.verdict !== "acceptable"} title="Inspect first. Only enabled when the customer paid at least the order price." busy={isBusy("accept_charged")} busyText="Sending…" onClick={() => onAction(o, "accept_charged")}>Accept payment &amp; send</Btn>
              : <Btn disabled title="Only an admin can accept a rejected payment" onClick={() => {}}>Accept &amp; send (admin only)</Btn>}
          </>
        )}

        {cat === "unpaid" && (
          <Btn busy={isBusy("verify_and_process")} busyText="Verifying…" onClick={() => onAction(o, "verify_and_process")}>Verify with Paystack</Btn>
        )}

        {paidCategory && <Btn busy={checks[o.reference]?.loading} busyText="Checking…" onClick={() => onCheck(o)}>Check Techlink</Btn>}

        {cat === "ready" && <Btn busy={isBusy("process_now")} busyText="Sending to Techlink…" onClick={() => onAction(o, "process_now")}>Send to Techlink now</Btn>}

        {(cat === "queued" || cat === "retryable") && cat === "queued" && o.result?.orderId && (
          <Btn busy={isBusy("recheck")} busyText="Checking…" onClick={() => onAction(o, "recheck")}>Re-check this order ID</Btn>
        )}

        {(cat === "queued" || cat === "retryable") && can("orders.confirm_from_evidence") && (
          <Btn disabled={!evidenceSaysDelivered} title={evidenceSaysDelivered ? "Closes the order because Techlink shows it delivered" : "Press “Check Techlink” first. This is only enabled when Techlink shows the order delivered."} busy={isBusy("confirm_from_techlink")} busyText="Closing…" onClick={() => onAction(o, "confirm_from_techlink")}>Confirm delivered (Techlink shows it)</Btn>
        )}

        {cat === "retryable" && (
          retryBlocked && !can("orders.confirm_fulfilled")
            ? <Btn disabled title="Techlink shows this order delivered or in progress. Retrying would deliver it twice." onClick={() => {}}>Retry blocked — see Techlink result</Btn>
            : retryBlocked
              ? <Btn danger busy={isBusy("retry")} busyText="Authorising…" onClick={() => onAction(o, "retry", { force: true })}>Force retry (may deliver twice)</Btn>
              : <Btn busy={isBusy("retry")} busyText="Authorising…" onClick={() => onAction(o, "retry")}>Authorise retry</Btn>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingTop: 8, borderTop: "1px dashed var(--border, #e5e7eb)", width: "100%" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>Manual control</span>
        {can("orders.manual_control") ? (
          <>
            <Btn busy={isBusy("mark_delivered")} busyText="Saving…" title="The customer has it (or you delivered it yourself). Closes the order as delivered." onClick={() => onAction(o, "mark_delivered")}>Mark delivered</Btn>
            {["unpaid", "charged_rejected"].includes(cat) && (
              <Btn busy={isBusy("mark_paid_send")} busyText="Sending…" title="You confirmed the payment yourself. Marks it paid and sends it to Techlink now." onClick={() => onAction(o, "mark_paid_send")}>Mark paid &amp; send to Techlink</Btn>
            )}
            <Btn busy={isBusy("mark_resolved")} busyText="Saving…" title="Close it without delivering (refunded, abandoned, or handled another way)." onClick={() => onAction(o, "mark_resolved")}>Mark resolved / close</Btn>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>Manual controls need the admin role.</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, help, tone, children, collapsible, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 16, borderColor: tone === "red" ? "#fca5a5" : undefined }}>
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: collapsible ? "pointer" : "default", background: tone === "red" ? "#fef2f2" : undefined }} onClick={() => collapsible && setOpen(!open)}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: tone === "red" ? "#991b1b" : undefined }}>{title} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({count})</span></div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{help}</div>
        </div>
        {collapsible && <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{open ? "Hide ▲" : "Show ▼"}</span>}
      </div>
      {open && children}
    </div>
  );
}

export default function AttentionTab({ orders, counts, truncated, can, busy, checks, payments, onAction, onCheck, onInspect, onRunWorker, workerBusy }) {
  const byAge = (list) => [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const charged = byAge(orders.filter((o) => o.category === "charged_rejected"));
  const paid = byAge(orders.filter((o) => ["ready", "queued", "retryable"].includes(o.category)));
  const unpaid = byAge(orders.filter((o) => o.category === "unpaid"));
  const card = (o) => <OrderCard key={o.reference} o={o} can={can} busy={busy} checks={checks} payments={payments} onAction={onAction} onCheck={onCheck} onInspect={onInspect} />;

  return (
    <div>
      {truncated && <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>Showing the oldest 50 only. There are more waiting: resolve these and refresh, or use “Run worker now” to clear the unpaid ones in bulk.</div>}
      {orders.length === 0 && <div className="card"><EmptyState>Nothing needs attention right now. 🎉</EmptyState></div>}
      <Section tone="red" title="Customer charged, nothing delivered" count={charged.length} help={SECTION_HELP.charged_rejected}>{charged.map(card)}</Section>
      <Section title="Paid — needs a decision" count={paid.length} help={SECTION_HELP.paid}>{paid.map(card)}</Section>
      <Section collapsible defaultOpen={paid.length === 0 && charged.length === 0} title="Unpaid checkouts" count={unpaid.length} help={SECTION_HELP.unpaid}>
        {can("worker.run") && (
          <div style={{ padding: "0 16px 8px" }}>
            <Btn busy={workerBusy} busyText="Running worker…" onClick={onRunWorker}>Run worker now — check all with Paystack</Btn>
          </div>
        )}
        {unpaid.map(card)}
      </Section>
    </div>
  );
}
