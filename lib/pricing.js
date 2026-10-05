// Centralized pricing engine. Provider cost (`baseAmount`) is kept separate from
// the customer-facing product price so margin is explicit and auditable.
// Configure service-specific rules with SERVICE_MARKUP_RULES_JSON, for example:
// {"data:mtn": {"percent": 2}, "airtime:telecel": {"percent": 1.5}, "water": {"fixed": 1}}
// The default business margin is 2%. Never treat the Paystack fee as business profit.

// A blank env var (""), which Vercel allows, must count as "not set". Number("")
// is 0, which would silently switch the fee or margin off.
function envBoolean(name, fallback) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function envNumber(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const PAYSTACK_FEE_RATE = Math.max(0, Math.min(0.5, envNumber("PAYSTACK_FEE_RATE", 0.0195)));

// Paystack can add the processing fee itself when "Pass fees to customers"
// is enabled in the merchant dashboard. PjDigitalServices currently uses
// that account setting, so the amount sent to Popup is the product price
// and Paystack adds the fee; checkoutAmount remains the expected gross total.
// The setting is configurable so fee-absorbing mode remains supported.
export function paystackPassesFeesToCustomers() {
  return envBoolean("PAYSTACK_PASS_FEES_TO_CUSTOMERS", true);
}

// PjDigitalServices default business margin. Service-specific rules can
// override this in SERVICE_MARKUP_RULES_JSON. Airtime (including bulk Airtime)
// and the plain Quick Data Top-up flow intentionally have 0% margin.
export const DEFAULT_BUSINESS_MARGIN_PERCENT = Math.max(0, Math.min(100, envNumber("DEFAULT_BUSINESS_MARGIN_PERCENT", 2)));

// Pricing policy requested by PjDigitalServices:
// - All Airtime flows (`airtime` and `tierBulkAirtime`): 0% business margin; only the Paystack processing fee is added.
// - Plain Quick Data Top-up (`orderType: data`): 0% business margin; only the Paystack processing fee is added.
// - All other services/tier products use the default 2% business margin unless
//   an explicit service-specific rule overrides it.
const NO_MARGIN_ORDER_TYPES = new Set(["airtime", "data", "tierbulkairtime"]);

export function hasNoBusinessMargin(orderType) {
  return NO_MARGIN_ORDER_TYPES.has(String(orderType || "").toLowerCase());
}

function parseRules() {
  try {
    const raw = process.env.SERVICE_MARKUP_RULES_JSON;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ruleFor(orderType, network) {
  const normalizedOrderType = String(orderType || "").toLowerCase();
  if (NO_MARGIN_ORDER_TYPES.has(normalizedOrderType)) return { percent: 0 };
  const rules = parseRules();
  const candidates = [
    `${String(orderType || "").toLowerCase()}:${String(network || "").toLowerCase()}`,
    String(orderType || "").toLowerCase(),
    "default",
  ];
  for (const key of candidates) {
    if (rules[key] && typeof rules[key] === "object") return rules[key];
  }
  return {};
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function businessMarkup(baseAmount, { orderType, network } = {}) {
  const base = Math.max(0, Number(baseAmount) || 0);
  const rule = ruleFor(orderType, network);
  const hasExplicitPercent = Object.prototype.hasOwnProperty.call(rule, "percent");
  const hasExplicitFixed = Object.prototype.hasOwnProperty.call(rule, "fixed");

  // Default policy is a 2% business margin. A fixed fee is used only when
  // explicitly configured for a particular service.
  const percent = hasExplicitPercent
    ? Math.max(0, Math.min(100, Number(rule.percent) || 0))
    : hasExplicitFixed
      ? 0
      : DEFAULT_BUSINESS_MARGIN_PERCENT;
  const fixed = hasExplicitFixed ? Math.max(0, Number(rule.fixed) || 0) : 0;

  return roundMoney(base * (percent / 100) + fixed);
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
// NOTE: SERVICE_MARKUP_RULES_JSON and DEFAULT_BUSINESS_MARGIN_PERCENT are
// server-only env vars, so in the browser bundle this falls back to the
// hardcoded 2% default rather than any custom per-service override — same
// limitation withPaystackFee already has for PAYSTACK_FEE_RATE. Still far
// closer to the real charge than omitting the markup entirely.
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

  const markupAmount = businessMarkup(pricingBase, { orderType, network });
  const customerProductAmount = roundMoney(pricingBase + markupAmount);
  const checkoutAmount = withPaystackFee(customerProductAmount);
  const paystackFeeAmount = roundMoney(checkoutAmount - customerProductAmount);
  // Paystack receives the service/customer amount. When Paystack passes fees
  // to the customer, it adds its processing fee at checkout. Do not reduce
  // this to customerProductAmount: checkoutAmount is the amount configured
  // for the Paystack charge and is also the amount used by the verification
  // calculation below.
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
