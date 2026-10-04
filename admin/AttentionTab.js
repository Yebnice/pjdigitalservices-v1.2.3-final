import { useState } from "react";
import { ageText, ghs, orderStatusBadge, orderNoOf, whenText } from "../../lib/adminClient";
import { DataTable, EmptyState, MONO, StatusPill, TD } from "./AdminUi";
import OrderDetails from "./OrderDetails";

const SECTION_HELP = {
  charged_rejected: "Paystack took the customer's money but the payment did not match the order, so nothing was sent. Inspect what Paystack took, then either accept it and send the order, or refund the customer and close it.",
  held: "Paystack confirms these were paid, but the app did NOT send them to Techlink: they were found by a check, are too old for automatic delivery, or delivery mode is manual. Nothing has been spent. Check Techlink, then approve each one you want delivered.",
  paid: "The customer's payment is confirmed. Before you retry or mark anything, press “Check Techlink”: it looks in Techlink's own order history so you don't have to guess whether it was already delivered.",
  unpaid: "No payment was ever confirmed for these. Most are people who closed the payment window. “Check outstanding orders” asks Paystack about every one: abandoned ones are closed, paid ones move up to “awaiting your approval”. It never sends anything to Techlink.",
};

const VERDICT = {
  delivered: { text: "Techlink shows this order as DELIVERED", color: "#16a34a" },
  in_progress: { text: "Techlink has this order and is still processing it", color: "#b45309" },
  failed_at_provider: { text: "Techlink shows this order FAILED — safe to retry", color: "#16a34a" },
  not_found: { text: "Techlink has NO record of this order — it was never delivered", color: "#16a34a" },
  unknown: { text: "Could not confirm either way", color: "#b45309" },
  not_checkable: { text: "Several recipients — cannot be matched automatically", color: "#b45309" },
};

function Btn({ children, onClick, busy, busyText, disabled, title, danger, primary }) {
  return (
    <button className="nav-item" style={{ width: "auto", padding: "5px 9px", fontSize: 12.5, ...(danger ? { borderColor: "#dc2626", color: "#991b1b" } : null), ...(primary ? { borderColor: "#16a34a", background: "#16a34a", color: "#fff", fontWeight: 600 } : null) }} disabled={busy || disabled} title={title} onClick={onClick}>
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
  const text = { acceptable: "Paid in full or more — safe to accept and send.", underpaid: `Underpaid by GHS ${Math.abs(p.difference).toFixed(2)} — cannot be sent. Refund it or collect the difference.`, wrong_currency: "Not paid in GHS.", not_paid: "Paystack does not show this payment as successful.", not_real_payment: "Not a real live payment (test mode or wrong reference) — cannot be sent." }[p.verdict] || p.verdict;
  return (
    <div style={{ fontSize: 12, borderLeft: `3px solid ${good ? "#16a34a" : "#dc2626"}`, paddingLeft: 10, margin: "4px 0" }}>
      <div style={{ fontWeight: 700, color: good ? "#16a34a" : "#dc2626" }}>Paystack took GHS {p.paid.toFixed(2)} · order costs GHS {p.expected.toFixed(2)}</div>
      <div style={{ color: "var(--muted)" }}>{text}</div>
      <div style={{ color: p.domain && p.domain !== "live" ? "#dc2626" : "var(--muted-dim)", fontWeight: p.domain && p.domain !== "live" ? 700 : 400 }}>
        {p.domain ? `Mode: ${p.domain === "live" ? "LIVE (real money)" : `${String(p.domain).toUpperCase()} — NOT real money`}` : "Mode: not reported"}
        {p.transactionId ? ` · Transaction ID ${p.transactionId}` : ""}{p.paidAt ? ` · paid ${whenText(p.paidAt)}` : ""}{p.channel ? ` · ${p.channel}` : ""}
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: "n", label: "#", width: 40 },
  { key: "no", label: "Order no. / Paystack ref" },
  { key: "product", label: "Product / recipient" },
  { key: "customer", label: "Customer" },
  { key: "total", label: "Total", align: "right" },
  { key: "status", label: "Status / waiting" },
  { key: "decision", label: "Decision" },
];

function OrderRows({ index, o, can, busy, checks, payments, onAction, onCheck, onInspect }) {
  const [showDetails, setShowDetails] = useState(false);
  const isBusy = (action) => Boolean(busy[`${o.reference}:${action}`]);
  const badge = orderStatusBadge(o);
  const cat = o.category;
  const waitingLong = (Date.now() - new Date(o.createdAt).getTime()) > 60 * 60000;
  const ev = checks[o.reference]?.evidence;
  const verdict = ev?.verdict;
  const evidenceSaysDelivered = verdict === "delivered";
  const retryBlocked = verdict === "delivered" || verdict === "in_progress";
  const paidCategory = ["ready", "queued", "retryable", "held"].includes(cat);
  // Spending wallet money needs the role set by WALLET_SPEND_ROLE (admin by default). The server enforces it; the buttons just say so.
  const canSpend = can("orders.spend_wallet");
  const spendHint = "Spends Techlink wallet money, which needs the admin role.";
  const hasNotes = cat === "charged_rejected" || (cat === "queued" && o.result?.orderId) || o.lastFulfillmentError || checks[o.reference] || payments[o.reference];

  return [
    <tr key={o.reference} style={{ background: cat === "charged_rejected" ? "#fef2f2" : undefined }}>
      <td style={{ ...TD, color: "var(--muted-dim)" }}>{index}</td>
      <td style={TD}>
        <div style={{ ...MONO, fontWeight: 700 }}>{orderNoOf(o)}</div>
        <div style={{ ...MONO, color: "var(--muted-dim)", marginTop: 2 }}>{o.reference}</div>
        {o.paystackTransactionId ? <div style={{ fontSize: 11, color: "var(--muted-dim)", marginTop: 2 }}>Txn {o.paystackTransactionId}</div> : null}
      </td>
      <td style={TD}>{o.orderType}{o.network ? ` · ${o.network}` : ""}<div style={{ color: "var(--muted)", marginTop: 2 }}>{o.phone || "—"}</div></td>
      <td style={{ ...TD, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.email || ""}>{o.email || "—"}</td>
      <td style={{ ...TD, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{ghs(o.checkoutAmount ?? o.amount)}</td>
      <td style={TD}>
        <StatusPill text={badge.text} tone={badge.tone} />
        <div style={{ fontSize: 12, marginTop: 4, color: waitingLong ? "#dc2626" : "var(--muted-dim)", fontWeight: waitingLong ? 600 : 400 }}>waiting {ageText(o.createdAt)}</div>
        <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>{whenText(o.createdAt)}</div>
      </td>
      <td style={{ ...TD, minWidth: 250 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {cat === "charged_rejected" && (
            <>
              <Btn busy={payments[o.reference]?.loading} busyText="Checking…" onClick={() => onInspect(o)}>Inspect what Paystack took</Btn>
              {can("orders.accept_charged")
                ? <Btn disabled={payments[o.reference]?.payment?.verdict !== "acceptable"} title="Inspect first. Only enabled when the customer paid at least the order price." busy={isBusy("accept_charged")} busyText="Sending…" onClick={() => onAction(o, "accept_charged")}>Accept payment &amp; send</Btn>
                : <Btn disabled title="Only an admin can accept a rejected payment" onClick={() => {}}>Accept &amp; send (admin only)</Btn>}
            </>
          )}

          {cat === "unpaid" && (
            <Btn busy={isBusy("verify_and_process")} busyText="Verifying…" title="Asks Paystack and records the answer. Never sends anything to Techlink." onClick={() => onAction(o, "verify_and_process")}>Verify with Paystack</Btn>
          )}

          {paidCategory && <Btn busy={payments[o.reference]?.loading} busyText="Asking Paystack…" title="Re-checks the payment with Paystack: live or test, exact amount, transaction ID." onClick={() => onInspect(o)}>Check Paystack</Btn>}
          {paidCategory && <Btn busy={checks[o.reference]?.loading} busyText="Checking…" onClick={() => onCheck(o)}>Check Techlink</Btn>}

          {cat === "held" && (
            retryBlocked && !can("orders.manual_control")
              ? <Btn disabled title="Techlink shows this order delivered or in progress. Approving would deliver it twice." onClick={() => {}}>Approve blocked — see Techlink result</Btn>
              : retryBlocked
                ? <Btn danger busy={isBusy("approve_delivery")} busyText="Sending…" onClick={() => onAction(o, "approve_delivery", { force: true })}>Force approve (may deliver twice)</Btn>
                : <Btn primary disabled={!canSpend} busy={isBusy("approve_delivery")} busyText="Re-checking & sending…" title={canSpend ? "Re-checks Paystack (live, exact amount), checks Techlink, then sends this order." : spendHint} onClick={() => onAction(o, "approve_delivery")}>Approve &amp; deliver</Btn>
          )}

          {cat === "ready" && <Btn disabled={!canSpend} title={canSpend ? undefined : spendHint} busy={isBusy("process_now")} busyText="Sending to Techlink…" onClick={() => onAction(o, "process_now")}>Send to Techlink now</Btn>}

          {cat === "queued" && o.result?.orderId && (
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
                : <Btn disabled={!canSpend} title={canSpend ? undefined : spendHint} busy={isBusy("retry")} busyText="Authorising…" onClick={() => onAction(o, "retry")}>Authorise retry &amp; send</Btn>
          )}
          <Btn onClick={() => setShowDetails((v) => !v)}>{showDetails ? "Hide details ▲" : "Details ▼"}</Btn>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border, #e5e7eb)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>Manual control</span>
          {can("orders.manual_control") ? (
            <>
              <Btn busy={isBusy("mark_delivered")} busyText="Saving…" title="The customer has it (or you delivered it yourself). Closes the order as delivered." onClick={() => onAction(o, "mark_delivered")}>Mark delivered</Btn>
              {["unpaid", "charged_rejected"].includes(cat) && (
                <Btn busy={isBusy("mark_paid_send")} busyText="Sending…" title="You confirmed the payment yourself. Marks it paid and sends it to Techlink now." onClick={() => onAction(o, "mark_paid_send")}>Mark paid &amp; send</Btn>
              )}
              <Btn busy={isBusy("mark_resolved")} busyText="Saving…" title="Close it without delivering (refunded, abandoned, or handled another way)." onClick={() => onAction(o, "mark_resolved")}>Mark resolved / close</Btn>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--muted-dim)" }}>Needs the admin role.</span>
          )}
        </div>
      </td>
    </tr>,
    hasNotes && (
      <tr key={`${o.reference}-notes`}>
        <td colSpan={COLUMNS.length} style={{ padding: "0 12px 10px 52px", borderBottom: "1px solid var(--line-soft, var(--line))" }}>
          {cat === "charged_rejected" && (
            <div style={{ fontSize: 12, color: "#991b1b" }}>Rejected: {o.failReason === "currency_mismatch" ? "wrong currency" : "amount did not match"}{o.paymentAmountGhs != null ? ` — Paystack recorded GHS ${o.paymentAmountGhs.toFixed(2)}` : ""}.</div>
          )}
          {cat === "queued" && o.result?.orderId && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Techlink order ID: {String(o.result.orderId)}</div>}
          {o.lastFulfillmentError && <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>{cat === "held" ? "Why it is held" : "Last error"}: {o.lastFulfillmentError}</div>}
          <EvidenceBox state={checks[o.reference]} />
          <PaymentBox state={payments[o.reference]} />
        </td>
      </tr>
    ),
    showDetails && (
      <tr key={`${o.reference}-details`}>
        <td colSpan={COLUMNS.length} style={{ padding: 0, background: "var(--surface-raised)", borderBottom: "1px solid var(--line)" }}><OrderDetails order={o} /></td>
      </tr>
    ),
  ];
}

function Section({ title, count, help, tone, children, collapsible, defaultOpen = true, actions }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 16, borderColor: tone === "red" ? "#fca5a5" : tone === "amber" ? "#fcd34d" : undefined }}>
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: collapsible ? "pointer" : "default", background: tone === "red" ? "#fef2f2" : tone === "amber" ? "#fffbeb" : undefined }} onClick={() => collapsible && setOpen(!open)}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: tone === "red" ? "#991b1b" : undefined }}>{title} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({count})</span></div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, maxWidth: 820 }}>{help}</div>
        </div>
        {collapsible && <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{open ? "Hide ▲" : "Show ▼"}</span>}
      </div>
      {open && actions}
      {open && <DataTable columns={COLUMNS} minWidth={1020}>{children}</DataTable>}
    </div>
  );
}

export default function AttentionTab({ orders, counts, truncated, can, busy, checks, payments, onAction, onCheck, onInspect, onRunWorker, workerBusy }) {
  const byAge = (list) => [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const charged = byAge(orders.filter((o) => o.category === "charged_rejected"));
  const held = byAge(orders.filter((o) => o.category === "held"));
  const paid = byAge(orders.filter((o) => ["ready", "queued", "retryable"].includes(o.category)));
  const unpaid = byAge(orders.filter((o) => o.category === "unpaid"));
  const rows = (list) => list.map((o, i) => <OrderRows key={o.reference} index={i + 1} o={o} can={can} busy={busy} checks={checks} payments={payments} onAction={onAction} onCheck={onCheck} onInspect={onInspect} />);

  return (
    <div>
      <div style={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong style={{ color: "var(--text)" }}>How this works:</strong> “Check outstanding orders” asks Paystack about old unpaid checkouts and lists what needs a decision. It delivers nothing (0 deliveries). You decide each order here.</div>
        {can("worker.run") && <Btn busy={workerBusy} busyText="Checking…" onClick={onRunWorker}>Check outstanding orders</Btn>}
      </div>
      {truncated && <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>Showing the oldest 50 only. There are more waiting: resolve these and refresh.</div>}
      {orders.length === 0 && <div className="card"><EmptyState>Nothing needs attention right now. 🎉</EmptyState></div>}
      <Section tone="red" title="Customer charged, nothing delivered" count={charged.length} help={SECTION_HELP.charged_rejected}>{rows(charged)}</Section>
      <Section tone="amber" title="Paid — awaiting your approval" count={held.length} help={SECTION_HELP.held}>{rows(held)}</Section>
      <Section title="Paid — needs a decision" count={paid.length} help={SECTION_HELP.paid}>{rows(paid)}</Section>
      <Section collapsible defaultOpen={paid.length === 0 && charged.length === 0 && held.length === 0} title="Unpaid checkouts" count={unpaid.length} help={SECTION_HELP.unpaid}>{rows(unpaid)}</Section>
    </div>
  );
}
