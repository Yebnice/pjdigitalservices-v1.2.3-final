import { registerCustomerAccount } from "../../../lib/customers";
import { hashPassword } from "../../../lib/passwords";
import { notifyCustomerVerifyEmail } from "../../../lib/notifications";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 5, windowMs: 60_000, keySuffix: "auth-register" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many attempts. Please wait a moment and try again." });

  try {
    const { name, username, email, phone, password } = req.body || {};
    if (!name || !username || !email || !phone || !password) {
      return res.status(400).json({ error: "Name, username, email, phone, and password are all required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (!/^[a-z0-9_.]{3,20}$/i.test(String(username))) {
      return res.status(400).json({ error: "Username must be 3–20 characters, letters, numbers, dots, or underscores only" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const passwordHash = hashPassword(password);
    const { customer, verificationToken } = await registerCustomerAccount({ name, username, email, phone, passwordHash });

    // Best-effort: the account is already created either way — a failed
    // verification email shouldn't block the person from existing, just
    // from logging in until they get a working verification link (they
    // can be resent one; not built as a separate endpoint yet, but the
    // account itself is not lost).
    try {
      await notifyCustomerVerifyEmail({ email: customer.email, name: customer.name, token: verificationToken });
    } catch (err) {
      console.error("Verification email failed to send", customer.email, err);
    }

    return res.status(200).json({ customer });
  } catch (err) {
    console.error("Customer account registration error", err);
    return res.status(400).json({ error: err.message.includes("already") ? err.message : "Something went wrong creating your account. Please try again." });
  }
}
