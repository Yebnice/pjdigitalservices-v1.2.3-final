import { getSupabase } from "./supabaseClient";
import { fromRow, orderedOrders } from "./store";
import { ORDER_FILTERS, fetchAllRows, normalizePageParams, sanitizeSearchTerm } from "./adminOrders";

// Read-only queries that exist for the admin dashboard. They live apart from
// lib/store.js on purpose: they read provider cost and business margin, which
// must never be reachable from the customer-facing order code in store.js
// (tests/deepAuditInvariants.test.js guards that boundary).

// Narrow-column read of every order created on/after `sinceIso`, for the
// dashboard overview. Never touches the encrypted AFA details or provider
// result blobs.
const OVERVIEW_COLUMNS = "reference,order_type,network,status,fulfilled,fulfillment_status,amount,provider_cost,checkout_amount,paystack_fee_amount,customer_product_amount,business_markup_amount,fail_reason,created_at,fulfilled_at,tier_details";

function overviewRow(row) {
  return {
    reference: row.reference,
    orderType: row.order_type,
    network: row.network,
    status: row.status,
    fulfilled: row.fulfilled,
    fulfillmentStatus: row.fulfillment_status || (row.fulfilled ? "fulfilled" : "pending"),
    amount: Number(row.amount),
    providerCost: row.provider_cost == null ? Number(row.amount) : Number(row.provider_cost),
    checkoutAmount: row.checkout_amount == null ? null : Number(row.checkout_amount),
    paystackFeeAmount: row.paystack_fee_amount == null ? null : Number(row.paystack_fee_amount),
    customerProductAmount: row.customer_product_amount == null ? null : Number(row.customer_product_amount),
    businessMarkupAmount: row.business_markup_amount == null ? null : Number(row.business_markup_amount),
    failReason: row.fail_reason,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at,
    tierName: row.tier_details?.name || null,
  };
}

export async function listOrdersForOverview(sinceIso = null) {
  const supabase = getSupabase();
  const rows = await fetchAllRows((from, to) => {
    let q = supabase.from("orders").select(OVERVIEW_COLUMNS);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return orderedOrders(q).range(from, to);
  });
  return rows.map(overviewRow);
}

// Every order where the customer has paid but nothing has been delivered,
// regardless of age — the dashboard's "money at risk" figure.
export async function listPaidUndelivered() {
  const supabase = getSupabase();
  const rows = await fetchAllRows((from, to) =>
    orderedOrders(supabase.from("orders").select(OVERVIEW_COLUMNS).eq("status", "payment_verified").eq("fulfilled", false).neq("fulfillment_status", "resolved")).range(from, to));
  return rows.map(overviewRow);
}

// Server-side filtered, searched and paginated order list for the Orders tab.
export async function listOrdersPage({ page, pageSize, filter = "all", search = "", from = null, to = null } = {}) {
  const supabase = getSupabase();
  const paging = normalizePageParams({ page, pageSize });
  const spec = ORDER_FILTERS[filter] || ORDER_FILTERS.all;
  const term = sanitizeSearchTerm(search);

  const build = (searchColumns) => {
    let q = supabase.from("orders").select("*", { count: "exact" });
    for (const [col, val] of spec.eq || []) q = q.eq(col, val);
    for (const [col, val] of spec.neq || []) q = q.neq(col, val);
    if (spec.in) q = q.in(spec.in[0], spec.in[1]);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    // Only ONE `or` is ever added to a query. Searching shows everything that
    // matches (including abandoned checkouts, which support may need to find);
    // otherwise abandoned checkouts are hidden from the general views, as they
    // already are on the customer side.
    if (term) q = q.or(searchColumns.map((c) => `${c}.ilike.%${term}%`).join(","));
    else if (filter !== "abandoned") q = q.or("fail_reason.is.null,fail_reason.neq.payment_abandoned");
    return orderedOrders(q).range(paging.from, paging.to);
  };

  // order_no and paystack_transaction_id come from migration_v1_4_0.sql. Until it
  // has been run, search the original columns rather than breaking the whole tab.
  let { data, error, count } = await build(["reference", "order_no", "paystack_transaction_id", "phone", "email", "order_type"]);
  if (error && term && /order_no|paystack_transaction_id/.test(String(error.message))) {
    ({ data, error, count } = await build(["reference", "phone", "email", "order_type"]));
  }
  if (error) throw new Error(error.message);
  const total = Number(count ?? 0);
  return {
    orders: (data || []).map(fromRow),
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
  };
}

// Techlink order ids already recorded against OTHER orders of ours for the same
// phone number. When matching an order against Techlink's history, these rows
// belong to someone else's purchase and must not be counted as this order's.
export async function listClaimedTechlinkIds(phone, excludeReference = null) {
  const local = String(phone || "").replace(/\D/g, "");
  if (!local) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("reference, result")
    .eq("phone", phone)
    .eq("fulfilled", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const ids = new Set();
  for (const row of data || []) {
    if (row.reference === excludeReference) continue;
    const id = row.result?.orderId;
    if (id != null) ids.add(String(id));
  }
  return ids;
}
