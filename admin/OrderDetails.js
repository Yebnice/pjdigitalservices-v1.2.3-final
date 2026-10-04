import { ghs, whenText, orderNoOf } from "../../lib/adminClient";
import { KeyValueTable } from "./AdminUi";

// Everything the admin dashboard knows about one order, in four small tables.
// Shared by the Orders tab and the Needs attention tab so both read the same.
export default function OrderDetails({ order }) {
  const o = order;
  const profit =
    o.paystackNetSettled != null && o.providerCost != null
      ? Math.round((o.paystackNetSettled - o.providerCost) * 100) / 100
      : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 22, padding: "14px 16px" }}>
      <KeyValueTable title="Receipt numbers" rows={[
        ["Order no. (ours)", orderNoOf(o), { strong: true, mono: true }],
        ["Paystack reference", o.reference, { mono: true }],
        ["Paystack transaction ID", o.paystackTransactionId, { mono: true }],
        ["Techlink order ID", o.result?.orderId != null ? String(o.result.orderId) : null, { mono: true }],
      ]} />
      <KeyValueTable title="Customer & recipient" rows={[
        ["Email", o.email],
        ["Recipient / account", o.phone ? `${o.phone}${o.meterNumber ? ` · meter ${o.meterNumber}` : ""}` : null],
        ["Network / service", o.network],
        ["AFA registrant", o.afaName],
      ]} />
      <KeyValueTable title="Money" rows={[
        ["Product price", o.customerProductAmount != null ? ghs(o.customerProductAmount) : null],
        ["Fee charged to customer", o.paystackFeeAmount != null ? ghs(o.paystackFeeAmount) : null],
        ["Total charged", ghs(o.checkoutAmount ?? o.amount), { strong: true }],
        ["Paystack took (verified)", o.paymentAmountGhs != null ? ghs(o.paymentAmountGhs) : null],
        ["Paystack fee (actual)", o.paystackFeeActual != null ? ghs(o.paystackFeeActual) : null],
        ["Net settled to you", o.paystackNetSettled != null ? ghs(o.paystackNetSettled) : null],
        ["Techlink cost", o.providerCost != null ? ghs(o.providerCost) : null],
        ["Margin on this order", profit != null ? ghs(profit) : null, { strong: true }],
      ]} />
      <KeyValueTable title="Timeline & delivery" rows={[
        ["Created", whenText(o.createdAt)],
        ["Payment verified", o.paymentVerifiedAt ? whenText(o.paymentVerifiedAt) : null],
        ["Delivered", o.fulfilledAt ? whenText(o.fulfilledAt) : null],
        ["Delivery attempts", o.fulfillmentAttempts > 0 ? String(o.fulfillmentAttempts) : null],
        ["Fail reason", o.failReason],
        ["Last delivery error", o.lastFulfillmentError],
        ["Admin resolution", o.manualReviewResolution],
      ]} />
    </div>
  );
}
