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
    if ([name, username, email, phone, password].some((v) => typeof v !== "string")) {
      return res.status(400).json({ error: "Invalid registration details" });
    }
    if (name.trim().length > 100 || email.length > 254 || phone.trim().length > 20 || password.length > 200) {
      return res.status(400).json({ error: "One of the fields is too long" });
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
    const { customer, verificationToken } = await registerCustomerAccount({ name: name.trim(), username, email: email.trim(), phone: phone.trim(), passwordHash });

    // Best-effort: the account is already created either way — a failed
    // verification email shouldn't block the person from existing, just
    // from logging in until they get a working verification link. They
    // can request a new one via POST /api/auth/resend-verification.
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
