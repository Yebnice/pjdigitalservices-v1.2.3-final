import { getSupabase } from "./supabaseClient";

function fromRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    orderReference: row.order_reference,
    customerName: row.customer_name,
    rating: row.rating,
    comment: row.comment,
    serviceType: row.service_type,
    isHidden: row.is_hidden,
  };
}

// Public review responses must not expose the Paystack/order reference or moderation state.
function toPublicReview(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    rating: row.rating,
    comment: row.comment,
    serviceType: row.service_type,
  };
}

export async function createReview({ orderReference, customerName, rating, comment, serviceType }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .insert({ order_reference: orderReference, customer_name: customerName, rating, comment: comment || null, service_type: serviceType || null })
    .select()
    .single();
  if (error) {
    // Unique index on order_reference: two simultaneous submissions can both pass
    // the "already reviewed?" check; the database makes sure only one lands.
    if (error.code === "23505") throw new Error("This order has already been reviewed");
    throw new Error(error.message);
  }
  return toPublicReview(data);
}

export async function hasReviewForOrder(orderReference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("reviews").select("id").eq("order_reference", orderReference).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

// Public listing — visible on the site. Hidden reviews (admin-moderated)
// are excluded here but still returned by listAllReviews for the admin tab.
export async function listPublicReviews(limit = 30) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(toPublicReview);
}

export async function listAllReviews() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function setReviewHidden(id, isHidden) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("reviews").update({ is_hidden: isHidden }).eq("id", id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}
