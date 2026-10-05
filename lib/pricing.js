// Centralized pricing engine. Provider cost is kept separate from the
// customer-facing product price so margin is explicit and auditable.
// Authoritative PjDigitalServices pricing policy:
// - Airtime, Quick Data and Bulk Airtime: 0% business margin.
// - Every other service handled here: exactly 2% business margin.
// - Paystack Ghana processing fee: 1.95%; when customer-fee pass-through is enabled, Paystack calculates and adds it at checkout.
// No environment variable may override the business-margin matrix.

function envNumber(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const PAYSTACK_FEE_RATE = Math.max(0, Math.min(0.5, envNumber("PAYSTACK_FEE_RATE", 0.0195)));

function envBoolean(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export const PAYSTACK_PASS_FEES_TO_CUSTOMERS = envBoolean("PAYSTACK_PASS_FEES_TO_CUSTOMERS", true);

// Amount actually supplied to Paystack. With customer-fee pass-through enabled,
// this MUST be the service/product amount only. Paystack then adds its own fee
// at checkout. The legacy fee-inclusive amount remains available when the
// pass-through setting is deliberately disabled.
export function getPaystackPaymentAmount(customerProductAmount, checkoutAmount, fallbackAmount = 0) {
  const product = Math.max(0, Number(customerProductAmount) || 0);
  const checkout = Math.max(0, Number(checkoutAmount) || 0);
  const fallback = Math.max(0, Number(fallbackAmount) || 0);
  return PAYSTACK_PASS_FEES_TO_CUSTOMERS ? (product || fallback) : (checkout || product || fallback);
}

// PjDigitalServices business margin is fixed at exactly 2% for all services
// outside NO_MARGIN_ORDER_TYPES. It is intentionally not deployment-configurable.
export const DEFAULT_BUSINESS_MARGIN_PERCENT = 2;

// Pricing policy requested by PjDigitalServices:
// - All Airtime flows (`airtime` and `tierBulkAirtime`): 0% business margin; Paystack adds its processing fee at checkout when pass-through is enabled.
// - Plain Quick Data Top-up (`orderType: data`): 0% business margin; Paystack adds its processing fee at checkout when pass-through is enabled.
// - All other services/tier products use the default 2% business margin unless
//   an explicit service-specific rule overrides it.
const NO_MARGIN_ORDER_TYPES = new Set(["airtime", "data", "tierbulkairtime"]);

export function hasNoBusinessMargin(orderType) {
  return NO_MARGIN_ORDER_TYPES.has(String(orderType || "").toLowerCase());
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function businessMarkup(baseAmount, { orderType } = {}) {
  const base = Math.max(0, Number(baseAmount) || 0);
  return hasNoBusinessMargin(orderType) ? 0 : roundMoney(base * 0.02);
}

// Paystack's documented "mark up your prices" formula for a percentage-only
// fee (support.paystack.com/en/articles/2130306) is:
//   Final Amount = (Price / (1 - Decimal Fee)) + 0.01
// The extra 0.01 guards against rounding: without it, a fee that Paystack rounds
// up (or a price that rounds down here) can settle 1 pesewa below Price.
// A zero price stays zero so empty form fields never show "GHS 0.01".
export const PAYSTACK_ROUNDING_GUARD = 0.01;

export function withPaystackFee(amount) {
  const base = Math.max(0, Number(amount) || 0);
  if (base === 0) return 0;
  const total = base / (1 - PAYSTACK_FEE_RATE) + PAYSTACK_ROUNDING_GUARD;
  return roundMoney(total);
}

export function paystackFeePortion(totalCharged) {
  const total = Math.max(0, Number(totalCharged) || 0);
  return roundMoney(total * PAYSTACK_FEE_RATE);
}

// Client-safe pre-checkout preview. It intentionally calls the same pricing
// engine used by the server, so Techlink's 2% fee, the 0%/2% business-margin
// matrix, and the Paystack gross-up formula cannot drift apart.
export function previewCustomerTotal(providerCost, { orderType, network } = {}) {
  const base = Math.max(0, Number(providerCost) || 0);
  return getOrderPricing({ providerCost: base, customerBaseAmount: base, orderType, network }).customerProductAmount;
}

// Same calculation as the server (getOrderPricing), split into the three
// numbers a customer should see before paying: price + processing fee = total.
// Uses getOrderPricing itself so there is only one formula to keep in sync.
export function previewBreakdown(providerCost, { orderType, network } = {}) {
  const base = Math.max(0, Number(providerCost) || 0);
  if (base === 0) return { productAmount: 0, feeAmount: 0, total: 0 };
  const p = getOrderPricing({ providerCost: base, customerBaseAmount: base, orderType, network });
  return {
    productAmount: p.customerProductAmount,
    feeAmount: PAYSTACK_PASS_FEES_TO_CUSTOMERS ? null : p.paystackFeeAmount,
    total: p.checkoutAmount,
  };
}

export function getOrderPricing({
  providerCost: rawProviderCost,
  customerBaseAmount: rawCustomerBaseAmount,
  orderType,
  network,
}) {
  const providerCost = roundMoney(rawProviderCost);
  const customerBaseAmount = roundMoney(
    rawCustomerBaseAmount == null ? providerCost : rawCustomerBaseAmount
  );

  // Airtime, Quick Data, and Bulk Airtime have 0% PjDigitalServices business
  // margin, but the customer price must first cover Techlink's 2% provider fee.
  // For those order types, customerBaseAmount is the face value and providerCost
  // should normally already include the Techlink fee. If providerCost does not
  // include it (for example a browser preview), apply the 2% rule here.
  const pricingBase = hasNoBusinessMargin(orderType)
    ? Math.max(customerBaseAmount, roundMoney(customerBaseAmount * (1 + DEFAULT_TECHLINK_FEE_RATE)))
    : providerCost;

  const markupAmount = businessMarkup(pricingBase, { orderType });
  const customerProductAmount = roundMoney(pricingBase + markupAmount);
  const checkoutAmount = PAYSTACK_PASS_FEES_TO_CUSTOMERS
    ? customerProductAmount
    : withPaystackFee(customerProductAmount);
  const paystackFeeAmount = PAYSTACK_PASS_FEES_TO_CUSTOMERS
    ? null
    : roundMoney(checkoutAmount - customerProductAmount);
  const paymentAmount = getPaystackPaymentAmount(
    customerProductAmount,
    checkoutAmount,
    providerCost
  );

  return {
    providerCost,
    markupAmount,
    customerProductAmount,
    checkoutAmount,
    paystackFeeAmount,
    paymentAmount,
  };
}


// Techlink's customer/platform fee is 2% for the Airtime/Quick Data flows
// covered by this pricing policy. Airtime may also resolve the live provider fee
// response; that rate remains an internal provider-cost input, while the locked
// customer-facing Techlink fee for the exempt flows remains 2%.
export const DEFAULT_TECHLINK_FEE_RATE = 0.02;
export const DEFAULT_AIRTIME_PROVIDER_FEE_RATE = Number.isFinite(Number(process.env.AIRTIME_PROVIDER_FEE_RATE)) && process.env.AIRTIME_PROVIDER_FEE_RATE !== undefined && process.env.AIRTIME_PROVIDER_FEE_RATE !== ""
  ? Number(process.env.AIRTIME_PROVIDER_FEE_RATE)
  : DEFAULT_TECHLINK_FEE_RATE;

// Accepts Techlink's { percent, rate } in either form. Returns a fraction
// between 0 and 1, or null when neither field is usable.
export function resolveAirtimeFeeRate(data) {
  const candidates = [
    data?.rate,
    data?.percent == null || data?.percent === "" ? null : Number(data.percent) / 100,
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}
