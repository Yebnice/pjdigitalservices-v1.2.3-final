import { setPasswordResetToken } from "../../../lib/customers";
import { notifyCustomerPasswordReset } from "../../../lib/notifications";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = rateLimit(req, { limit: 5, windowMs: 60_000, keySuffix: "forgot-password" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many attempts. Please wait a moment and try again." });
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Enter your email address" });
    const result = await setPasswordResetToken(email);
    // Always the same response whether or not an account exists — telling
    // the truth here ("no account with that email") would let anyone
    // check which emails are registered on the site.
    if (result) {
      try {
        await notifyCustomerPasswordReset({ email: result.customer.email, name: result.customer.name, token: result.resetToken });
      } catch (err) {
        console.error("Password reset email failed to send", email, err);
      }
    }
    return res.status(200).json({ message: "If an account exists with that email, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot password error", err);
    return res.status(200).json({ message: "If an account exists with that email, a reset link has been sent." });
  }
}
