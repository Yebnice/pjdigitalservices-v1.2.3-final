// Centralized pricing engine. Provider cost is kept separate from the
// customer-facing product price so margin is explicit and auditable.
// Authoritative PjDigitalServices pricing policy:
// - Airtime, Quick Data and Bulk Airtime: 0% business margin.
// - Every other service handled here: exactly 2% business margin.
// - Paystack Ghana processing fee: 1.95%, calculated by PjDigitalServices.
// No environment variable may override the business-margin matrix.

function envNumber(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const PAYSTACK_FEE_RATE = Math.max(0, Math.min(0.5, envNumber("PAYSTACK_FEE_RATE", 0.0195)));

// PjDigitalServices business margin is fixed at exactly 2% for all services
// outside NO_MARGIN_ORDER_TYPES. It is intentionally not deployment-configurable.
export const DEFAULT_BUSINESS_MARGIN_PERCENT = 2;

// Pricing policy requested by PjDigitalServices:
// - All Airtime flows (`airtime` and `tierBulkAirtime`): 0% business margin; only the Paystack processing fee is added.
// - Plain Quick Data Top-up (`orderType: data`): 0% business margin; only the Paystack processing fee is added.
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

// Client-safe pre-checkout preview: pairs the business markup with the
// Paystack fee so a "Pay GHS X" button matches what /api/orders/create will
// actually charge via getOrderPricing(). Previously several pages called
// withPaystackFee(rawAmount) directly, which adds the Paystack fee but
// silently skips the business markup — understating the real total for
// every order type except the explicitly 0%-margin ones (airtime, data,
// tierBulkAirtime), where the two calls happen to agree.
// NOTE: SERVICE_MARKUP_RULES_JSON is server-only, so browser previews use the
// fixed 2% default. The server remains authoritative and rechecks the final
// amount before payment/fulfilment.
export function previewCustomerTotal(providerCost, { orderType, network } = {}) {
  const base = Math.max(0, Number(providerCost) || 0);
  const markup = businessMarkup(base, { orderType, network });
  return withPaystackFee(base + markup);
}

// Same calculation as the server (getOrderPricing), split into the three
// numbers a customer should see before paying: price + processing fee = total.
// Uses getOrderPricing itself so there is only one formula to keep in sync.
export function previewBreakdown(providerCost, { orderType, network } = {}) {
  const base = Math.max(0, Number(providerCost) || 0);
  if (base === 0) return { productAmount: 0, feeAmount: 0, total: 0 };
  const p = getOrderPricing({ providerCost: base, customerBaseAmount: base, orderType, network });
  return { productAmount: p.customerProductAmount, feeAmount: p.paystackFeeAmount, total: p.checkoutAmount };
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

  // Airtime's Techlink wallet fee is a business/provider cost, not a
  // customer-facing PjDigitalServices markup. Quick Data has no separate
  // provider fee. Both Airtime flows and plain Quick Data therefore start
  // customer pricing from the actual service amount and apply 0% business margin.
  const pricingBase = hasNoBusinessMargin(orderType) ? customerBaseAmount : providerCost;

  const markupAmount = businessMarkup(pricingBase, { orderType });
  const customerProductAmount = roundMoney(pricingBase + markupAmount);
  const checkoutAmount = withPaystackFee(customerProductAmount);
  const paystackFeeAmount = roundMoney(checkoutAmount - customerProductAmount);
  // Ghana fee handling is implemented by PjDigitalServices. Paystack's current
  // Ghana pricing is 1.95%, and its transaction API initializes the transaction
  // with the amount supplied by the merchant. Therefore the fee-inclusive
  // checkout amount must be the amount sent to Paystack. There is no second
  // automatic customer-fee pass-through step in this pricing path.
  const paymentAmount = checkoutAmount;

  return {
    providerCost,
    markupAmount,
    customerProductAmount,
    checkoutAmount,
    paystackFeeAmount,
    paymentAmount,
  };
}


// Techlink adds a service fee to every airtime purchase when it debits our
// wallet (documented as 2%). It only affects what we record as cost: the
// customer's price is face value plus the Paystack fee. If the live fee lookup
// fails, assume the documented rate rather than 0%, otherwise the dashboard
// quietly overstates airtime profit.
export const DEFAULT_AIRTIME_PROVIDER_FEE_RATE = Number.isFinite(Number(process.env.AIRTIME_PROVIDER_FEE_RATE)) && process.env.AIRTIME_PROVIDER_FEE_RATE !== undefined && process.env.AIRTIME_PROVIDER_FEE_RATE !== ""
  ? Number(process.env.AIRTIME_PROVIDER_FEE_RATE)
  : 0.02;

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
