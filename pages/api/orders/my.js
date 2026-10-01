import { getAuthedCustomer } from "../../../lib/customerAuth";
import { listOrdersByEmail, toPublicOrder } from "../../../lib/store";
import { checkQueuedOrder } from "../../../lib/orderProcessing";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 20, windowMs: 60_000, keySuffix: "orders-my" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please wait a moment." });
  try {
    const customer = await getAuthedCustomer(req);
    if (!customer) return res.status(401).json({ error: "Not logged in" });
    let orders = await listOrdersByEmail(customer.email);
    // Same lazy verify-on-view as order tracking — re-check any queued
    // order the moment someone actually looks at their order list.
    // One provider hiccup on a single order must not blank the whole list.
    orders = await Promise.all(orders.map(async (o) => {
      if (o.fulfillmentStatus !== "queued_with_provider") return o;
      try {
        return (await checkQueuedOrder(o.reference)) || o;
      } catch (err) {
        console.error("Queued order re-check failed for", o.reference, err?.message);
        return o;
      }
    }));
    return res.status(200).json({ orders: orders.map(toPublicOrder) });
  } catch (err) {
    console.error("List my orders error", err);
    return res.status(500).json({ error: "Could not load your orders" });
  }
}
