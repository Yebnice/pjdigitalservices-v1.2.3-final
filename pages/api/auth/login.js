import { findCustomerCredentialsByIdentifier, toPublicCustomer } from "../../../lib/customers";
import { hashPassword, verifyPassword } from "../../../lib/passwords";
import { createCustomerSession } from "../../../lib/customerAuth";
import { rateLimit } from "../../../lib/rateLimit";

// Verified against when the account doesn't exist, so "no such account" costs
// the same time as "wrong password" and response timing can't reveal which
// emails/usernames are registered.
let dummyHash;
function getDummyHash() {
  if (!dummyHash) dummyHash = hashPassword("timing-equalisation-placeholder");
  return dummyHash;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 10, windowMs: 10 * 60_000, keySuffix: "auth-login" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many login attempts. Please wait a moment and try again." });

  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: "Enter your email/username and password" });
    if (typeof identifier !== "string" || typeof password !== "string" || password.length > 200) {
      return res.status(400).json({ error: "Enter a valid email/username and password" });
    }
    // Per-account throttle on top of the per-IP one, so a botnet rotating IPs
    // still can't grind away at a single account.
    const rlAccount = await rateLimit(req, {
      limit: 10, windowMs: 15 * 60_000, keySuffix: "auth-login-account",
      subject: identifier.trim().toLowerCase().slice(0, 254),
    });
    if (!rlAccount.allowed) return res.status(429).setHeader("Retry-After", rlAccount.retryAfter).json({ error: "Too many login attempts for this account. Please wait a few minutes and try again." });

    const row = await findCustomerCredentialsByIdentifier(identifier);
    // Same generic message whether the account doesn't exist or the
    // password is wrong — this is deliberate: distinguishing the two lets
    // an attacker enumerate which emails/usernames have accounts.
    const genericError = "Incorrect email/username or password";
    if (!row || !row.password_hash) {
      verifyPassword(password, getDummyHash());
      return res.status(401).json({ error: genericError });
    }
    if (!verifyPassword(password, row.password_hash)) return res.status(401).json({ error: genericError });
    if (!row.email_verified) {
      return res.status(403).json({ error: "Please verify your email before logging in — check your inbox for the verification link." });
    }

    try {
      createCustomerSession(res, row.id, row.password_hash);
    } catch (err) {
      console.error("Could not create customer session —", err.message);
      return res.status(500).json({ error: "Server misconfigured: CUSTOMER_SESSION_SECRET is missing or invalid." });
    }

    return res.status(200).json({ customer: toPublicCustomer(row) });
  } catch (err) {
    console.error("Customer login error", err);
    return res.status(500).json({ error: "Something went wrong logging you in. Please try again." });
  }
}
