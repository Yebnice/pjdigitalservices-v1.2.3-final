// Compares what Paystack actually charged us (verify response `fees`, in
// pesewas) with what we expected, so a rate change, VAT, or a rounding
// surprise is noticed on the first order instead of eroding margin silently.
//
// Pure functions only: no database, no network.

const TOLERANCE_GHS = 0.011; // 1 pesewa of rounding, with float slack

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Returns null when the transaction carries no usable fee figure.
export function readPaystackFees(txn) {
  const raw = txn?.fees;
  if (raw === undefined || raw === null || raw === "") return null;
  const pesewas = Number(raw);
  const amountPesewas = Number(txn?.amount);
  if (!Number.isFinite(pesewas) || pesewas < 0 || !Number.isFinite(amountPesewas)) return null;
  return {
    feeGhs: round2(pesewas / 100),
    netGhs: round2((amountPesewas - pesewas) / 100),
  };
}

// Paystack's own numeric transaction id (shown on receipts as the transaction
// id, next to the reference). Null when the response does not carry one.
export function readPaystackTransactionId(txn) {
  const id = txn?.id;
  return id === undefined || id === null || id === "" ? null : String(id);
}

// status:
//   "unavailable"     Paystack sent no fee figure (nothing to compare)
//   "ok"              net >= product price and fee is within 1 pesewa of expected
//   "fee_differs"     fee is not what we computed, but we still received the price
//   "net_below_price" we settle LESS than the product price: this order loses money
export function assessPaystackFee(order, txn) {
  const read = readPaystackFees(txn);
  if (!read) return { status: "unavailable" };

  const productAmount = Number(order?.customerProductAmount ?? order?.amount);
  const expectedFee = order?.paystackFeeAmount == null ? null : Number(order.paystackFeeAmount);
  const base = { feeGhs: read.feeGhs, netGhs: read.netGhs, expectedFeeGhs: expectedFee, productAmount };

  if (Number.isFinite(productAmount) && read.netGhs < productAmount - 0.0001) {
    return { ...base, status: "net_below_price", shortfallGhs: round2(productAmount - read.netGhs) };
  }
  if (expectedFee != null && Number.isFinite(expectedFee) && Math.abs(read.feeGhs - expectedFee) > TOLERANCE_GHS) {
    return { ...base, status: "fee_differs", differenceGhs: round2(read.feeGhs - expectedFee) };
  }
  return { ...base, status: "ok" };
}

export function describeFeeProblem(assessment) {
  const a = assessment || {};
  if (a.status === "net_below_price") {
    return `Paystack fee GHS ${a.feeGhs.toFixed(2)}: we settle GHS ${a.netGhs.toFixed(2)}, which is GHS ${a.shortfallGhs.toFixed(2)} BELOW the product price GHS ${a.productAmount.toFixed(2)}. Check the Paystack rate, VAT and rounding.`;
  }
  if (a.status === "fee_differs") {
    return `Paystack charged GHS ${a.feeGhs.toFixed(2)} but we expected GHS ${a.expectedFeeGhs.toFixed(2)} (difference ${a.differenceGhs > 0 ? "+" : ""}${a.differenceGhs.toFixed(2)}). The price still covers it, but PAYSTACK_FEE_RATE may be out of date.`;
  }
  return "";
}
