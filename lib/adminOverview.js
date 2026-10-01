import { PAYSTACK_FEE_RATE } from "./pricing";

// Pure calculation of the dashboard overview from narrow order rows.
// Runs on the server so the numbers cover EVERY order in range (the old
// client-side version only ever saw whatever the browser had loaded), and so
// the browser no longer downloads the whole orders table just to draw charts.
//
// Day boundaries are UTC. Ghana is UTC+0 year-round, so these match local
// calendar days for this business.

export const OVERVIEW_RANGES = {
  today: { label: "Today", days: 1 },
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  all: { label: "All time", days: null },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PAID_STATUSES = ["payment_verified", "success"];
const PAYMENT_FAILED_STATUSES = ["payment_failed", "failed"];

export function rangeStart(range, now = new Date()) {
  const def = OVERVIEW_RANGES[range];
  if (!def || def.days == null) return null;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (def.days - 1));
  return d;
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function productLabel(order) {
  if (order.tierName) return order.network && order.network !== order.orderType ? `${order.tierName} (${String(order.network).toUpperCase()})` : order.tierName;
  const base = order.orderType || "order";
  return order.network && order.network !== order.orderType && ["airtime", "data"].includes(base) ? `${base} — ${String(order.network).toUpperCase()}` : base;
}

export function estimatedNetProfit(order, feeRate = PAYSTACK_FEE_RATE) {
  // What Paystack actually keeps is a percentage of the TOTAL the customer
  // paid, and providerCost is what Techlink debits from the wallet (including
  // the airtime wallet fee). Everything left over is profit — an estimate,
  // because Paystack's real fee can differ by payment method.
  const charged = Number(order.checkoutAmount ?? order.customerProductAmount ?? order.amount ?? 0);
  return charged * (1 - feeRate) - Number(order.providerCost ?? order.amount ?? 0);
}

export function computeOverview(orders, { range = "7d", now = new Date(), atRiskOrders = [], feeRate = PAYSTACK_FEE_RATE } = {}) {
  const def = OVERVIEW_RANGES[range] ? range : "7d";
  const start = rangeStart(def, now);
  const inRange = (orders || []).filter((o) => o.createdAt && (!start || new Date(o.createdAt) >= start));

  const realCheckouts = inRange.filter((o) => o.failReason !== "payment_abandoned");
  const abandoned = inRange.length - realCheckouts.length;
  // Orders an admin closed without delivery (refunded / handled elsewhere) are
  // paid but are not a delivery failure, so they stay out of the success rates.
  const paid = realCheckouts.filter((o) => PAID_STATUSES.includes(o.status) && o.fulfillmentStatus !== "resolved");
  const delivered = realCheckouts.filter((o) => o.status === "success" || o.fulfillmentStatus === "fulfilled");
  const paymentFailed = realCheckouts.filter((o) => PAYMENT_FAILED_STATUSES.includes(o.status));
  const deliveryFailed = realCheckouts.filter((o) => o.fulfillmentStatus === "failed" && !PAYMENT_FAILED_STATUSES.includes(o.status));
  const awaitingPayment = realCheckouts.filter((o) => ["pending", "payment_pending"].includes(o.status));

  // Money is counted on delivered orders only, so revenue is never claimed for
  // something the customer has not received.
  const sum = (list, pick) => list.reduce((s, o) => s + Number(pick(o) || 0), 0);
  const productSales = sum(delivered, (o) => o.customerProductAmount ?? o.amount);
  const businessMargin = sum(delivered, (o) => o.businessMarkupAmount);
  const customerPayments = sum(delivered, (o) => o.checkoutAmount ?? o.customerProductAmount ?? o.amount);
  const feesCharged = sum(delivered, (o) => o.paystackFeeAmount);
  const providerCost = sum(delivered, (o) => o.providerCost ?? o.amount);
  const netProfit = sum(delivered, (o) => estimatedNetProfit(o, feeRate));

  // Customers who have paid (any time) but not received their order yet.
  const stuck = (atRiskOrders || []).filter((o) => o.status === "payment_verified" && !o.fulfilled);
  const oldest = stuck.reduce((min, o) => (o.createdAt && (min == null || new Date(o.createdAt) < min) ? new Date(o.createdAt) : min), null);

  // Daily trend (product sales + order count), capped to 30 days.
  const trendDays = OVERVIEW_RANGES[def].days && OVERVIEW_RANGES[def].days <= 30 ? OVERVIEW_RANGES[def].days : 30;
  const trendStart = rangeStart(trendDays === 1 ? "today" : trendDays === 7 ? "7d" : "30d", now);
  const buckets = {};
  for (const o of delivered) {
    if (new Date(o.createdAt) < trendStart) continue;
    const k = dayKey(o.createdAt);
    buckets[k] = buckets[k] || { sales: 0, orders: 0 };
    buckets[k].sales += Number(o.customerProductAmount ?? o.amount ?? 0);
    buckets[k].orders += 1;
  }
  const trend = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const k = dayKey(d);
    trend.push({ key: k, sales: round2(buckets[k]?.sales), orders: buckets[k]?.orders || 0 });
  }

  const productMap = {};
  for (const o of delivered) {
    const label = productLabel(o);
    const p = (productMap[label] = productMap[label] || { label, orders: 0, sales: 0, profit: 0 });
    p.orders += 1;
    p.sales += Number(o.customerProductAmount ?? o.amount ?? 0);
    p.profit += estimatedNetProfit(o, feeRate);
  }
  const products = Object.values(productMap)
    .map((p) => ({ ...p, sales: round2(p.sales), profit: round2(p.profit) }))
    .sort((a, b) => b.sales - a.sales);

  return {
    range: def,
    rangeLabel: OVERVIEW_RANGES[def].label,
    generatedAt: new Date(now).toISOString(),
    counts: {
      checkouts: realCheckouts.length,
      paid: paid.length,
      delivered: delivered.length,
      paymentFailed: paymentFailed.length,
      deliveryFailed: deliveryFailed.length,
      awaitingPayment: awaitingPayment.length,
      abandoned,
    },
    money: {
      productSales: round2(productSales),
      businessMargin: round2(businessMargin),
      customerPayments: round2(customerPayments),
      feesCharged: round2(feesCharged),
      providerCost: round2(providerCost),
      netProfit: round2(netProfit),
      avgOrderValue: delivered.length ? round2(customerPayments / delivered.length) : 0,
    },
    // Share of payment attempts that succeeded (abandoned checkouts are the
    // customer closing the popup, not a failed payment, so they are excluded).
    rates: {
      payment: paid.length + paymentFailed.length ? Math.round((paid.length / (paid.length + paymentFailed.length)) * 100) : null,
      fulfillment: paid.length ? Math.round((delivered.length / paid.length) * 100) : null,
    },
    atRisk: {
      count: stuck.length,
      value: round2(stuck.reduce((s, o) => s + Number(o.checkoutAmount ?? o.amount ?? 0), 0)),
      oldestMinutes: oldest ? Math.max(0, Math.round((new Date(now) - oldest) / 60000)) : null,
    },
    trend,
    products: products.slice(0, 8),
  };
}
