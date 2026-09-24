import { getAuthedCustomerId } from "../../../lib/customerAuth";
import { findCustomerById } from "../../../lib/customers";
import { listOrdersByEmail } from "../../../lib/store";
import { checkQueuedOrder } from "../../../lib/orderProcessing";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const rl = rateLimit(req, { limit: 20, windowMs: 60_000, keySuffix: "orders-my" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please wait a moment." });
  const customerId = getAuthedCustomerId(req);
  if (!customerId) return res.status(401).json({ error: "Not logged in" });
  try {
    const customer = await findCustomerById(customerId);
    if (!customer) return res.status(401).json({ error: "Not logged in" });
    let orders = await listOrdersByEmail(customer.email);
    // Same lazy verify-on-view as order tracking — re-check any queued
    // order the moment someone actually looks at their order list.
    orders = await Promise.all(orders.map((o) => (o.fulfillmentStatus === "queued_with_provider" ? checkQueuedOrder(o.reference) : o)));
    return res.status(200).json({ orders });
  } catch (err) {
    console.error("List my orders error", err);
    return res.status(500).json({ error: "Could not load your orders" });
  }
}
