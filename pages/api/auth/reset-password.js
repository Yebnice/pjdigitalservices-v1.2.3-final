import { resetPasswordWithToken } from "../../../lib/customers";
import { hashPassword } from "../../../lib/passwords";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 10, windowMs: 60_000, keySuffix: "reset-password" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many attempts. Please wait a moment and try again." });
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: "Missing token or new password" });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const customer = await resetPasswordWithToken(String(token), hashPassword(password));
    if (!customer) return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one from the login page." });
    return res.status(200).json({ customer });
  } catch (err) {
    console.error("Reset password error", err);
    return res.status(500).json({ error: "Something went wrong resetting your password. Please try again." });
  }
}
