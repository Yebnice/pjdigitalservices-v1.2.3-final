import { verifyCustomerEmail } from "../../../lib/customers";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = rateLimit(req, { limit: 10, windowMs: 60_000, keySuffix: "verify-email" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many attempts. Please wait a moment and try again." });
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing verification token" });
    const customer = await verifyCustomerEmail(String(token));
    if (!customer) return res.status(400).json({ error: "This verification link is invalid or has expired. Request a new one by trying to log in." });
    return res.status(200).json({ customer });
  } catch (err) {
    console.error("Email verification error", err);
    return res.status(500).json({ error: "Something went wrong verifying your email. Please try again." });
  }
}
