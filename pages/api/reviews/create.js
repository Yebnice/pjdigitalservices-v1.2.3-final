import { findCustomerOrder } from "../../../lib/store";
import { createReview, hasReviewForOrder } from "../../../lib/reviews";
import { recordAuditEvent } from "../../../lib/auditLog";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 5, windowMs: 60_000, keySuffix: "reviews-create" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many attempts. Please wait a moment and try again." });
  try {
    const { orderReference, email, name, rating, comment } = req.body || {};
    if (!orderReference || !email || !name || !rating) {
      return res.status(400).json({ error: "Order reference, email, name, and a star rating are all required" });
    }
    const ratingNumber = Number(rating);
    if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
      return res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
    }
    // Only a real purchaser, matched by their own order reference AND the
    // email they checked out with, can leave a review — this is what
    // keeps reviews trustworthy instead of open to anyone typing anything.
    const order = await findCustomerOrder(String(orderReference).trim(), String(email).trim().toLowerCase());
    if (!order) return res.status(404).json({ error: "We couldn't find an order with that reference and email" });
    if (order.status !== "success") return res.status(400).json({ error: "Only completed orders can be reviewed" });
    if (await hasReviewForOrder(order.reference)) return res.status(400).json({ error: "This order has already been reviewed" });

    const review = await createReview({
      orderReference: order.reference,
      customerName: String(name).trim().slice(0, 60),
      rating: ratingNumber,
      comment: comment ? String(comment).trim().slice(0, 500) : null,
      serviceType: order.orderType,
    });
    await recordAuditEvent({ action: "review_submitted", reference: order.reference, note: `${ratingNumber} stars` });
    return res.status(200).json({ review });
  } catch (err) {
    console.error("Review submission error", err);
    return res.status(500).json({ error: "Something went wrong submitting your review. Please try again." });
  }
}
