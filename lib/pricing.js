// Centralized pricing engine. Provider cost (`baseAmount`) is kept separate from
// the customer-facing product price so margin is explicit and auditable.
// Configure service-specific rules with SERVICE_MARKUP_RULES_JSON, for example:
// {"data:mtn": {"percent": 2}, "airtime:telecel": {"percent": 1.5}, "water": {"fixed": 1}}
// The default business margin is 1%. Never treat the Paystack fee as business profit.

export const PAYSTACK_FEE_RATE = Number.isFinite(Number(process.env.PAYSTACK_FEE_RATE))
  ? Math.max(0, Math.min(0.5, Number(process.env.PAYSTACK_FEE_RATE)))
  : 0.0195;

// PjDigitalServices default business margin. Service-specific rules can
// override this in SERVICE_MARKUP_RULES_JSON. Airtime and the plain Quick
// Data Top-up flow intentionally have an explicit 0% margin.
export const DEFAULT_BUSINESS_MARGIN_PERCENT = Number.isFinite(Number(process.env.DEFAULT_BUSINESS_MARGIN_PERCENT))
  ? Math.max(0, Math.min(100, Number(process.env.DEFAULT_BUSINESS_MARGIN_PERCENT)))
  : 1;

// Pricing policy requested by PjDigitalServices:
// - Plain Airtime: 0% business margin; recover only the Paystack fee.
// - Plain Quick Data Top-up (`orderType: data`): 0% business margin.
// - All other services/tier products use the default 1% margin unless an
//   explicit service-specific rule overrides it.
const NO_MARGIN_ORDER_TYPES = new Set(["airtime", "tierbulkairtime", "data"]);

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
  const percent = hasExplicitPercent
    ? Math.max(0, Math.min(100, Number(rule.percent) || 0))
    : DEFAULT_BUSINESS_MARGIN_PERCENT;
  const fixed = Math.max(0, Number(rule.fixed) || 0);
  return roundMoney(base * (percent / 100) + fixed);
}

export function withPaystackFee(amount) {
  const base = Math.max(0, Number(amount) || 0);
  const total = base / (1 - PAYSTACK_FEE_RATE);
  return roundMoney(total);
}

export function paystackFeePortion(totalCharged) {
  const total = Math.max(0, Number(totalCharged) || 0);
  return roundMoney(total * PAYSTACK_FEE_RATE);
}

export function getOrderPricing({ providerCost: rawProviderCost, orderType, network }) {
  const providerCost = roundMoney(rawProviderCost);
  const markupAmount = businessMarkup(providerCost, { orderType, network });
  const customerProductAmount = roundMoney(providerCost + markupAmount);
  const checkoutAmount = withPaystackFee(customerProductAmount);
  const paystackFeeAmount = roundMoney(checkoutAmount - customerProductAmount);
  return { providerCost, markupAmount, customerProductAmount, checkoutAmount, paystackFeeAmount };
}
