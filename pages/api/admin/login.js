import { authenticateAdmin, createAdminSession, totpSecretFor, twoFactorRequired } from "../../../lib/adminAuth";
import { rateLimit } from "../../../lib/rateLimit";
import { recordAuditEvent } from "../../../lib/auditLog";
import { getAppSetting, setAppSetting } from "../../../lib/appSettings";
import { verifyTotp } from "../../../lib/totp";

const GENERIC_FAILURE = "Invalid admin credentials or code.";

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] || req.socket?.remoteAddress || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Limit by caller (IP)...
  const ip = await rateLimit(req, { limit: 10, windowMs: 10 * 60_000, keySuffix: "admin-login" });
  if (!ip.allowed) return res.status(429).json({ error: "Too many login attempts. Try again later." });
  // ...and by ACCOUNT, so an attacker who rotates IP addresses still runs out of guesses.
  const username = String(req.body?.username || "").trim().toLowerCase().slice(0, 60);
  const acct = await rateLimit(req, { limit: 10, windowMs: 10 * 60_000, keySuffix: "admin-login-account", subject: username || "(blank)" });
  if (!acct.allowed) return res.status(429).json({ error: "Too many login attempts. Try again later." });

  const key = clientKey(req);
  const fail = async (reason) => {
    // The password and the code are never recorded. Bounded by the limits above, so this cannot flood the log.
    const tried = username.replace(/[^a-z0-9@._-]/g, "").slice(0, 40) || "(blank)";
    await recordAuditEvent({ actor: "unauthenticated", action: "admin_login_failed", note: `Failed sign-in as "${tried}" from IP ${key} (${reason})` });
    return res.status(401).json({ error: GENERIC_FAILURE });
  };

  const identity = authenticateAdmin(req.body?.username, req.body?.password);
  if (!identity) return fail("password");

  // ---- Second factor ----
  const secret = totpSecretFor(identity);
  if (!secret && twoFactorRequired()) {
    await recordAuditEvent({ actor: identity.username, action: "admin_login_blocked_no_2fa", note: `Correct password, but two-factor is required and no authenticator is set up (IP ${key})` });
    return res.status(403).json({ error: "Two-factor sign-in is required but not set up for this account. Ask an administrator to run `npm run admin:user` and add the secret." });
  }
  let mfa = false;
  if (secret) {
    if (secret === "INVALID") return fail("two-factor secret misconfigured");
    const settingKey = `admin_totp_last:${identity.username}`;
    let last = null;
    try {
      const stored = await getAppSetting(settingKey);
      last = stored?.counter ?? null;
    } catch (err) {
      // Cannot prove the code is fresh, so do not let anyone in.
      console.error("Could not read the two-factor replay marker", err);
      return res.status(503).json({ error: "Sign-in is temporarily unavailable. Try again shortly." });
    }
    const check = verifyTotp(secret, req.body?.code, { lastUsedCounter: last });
    if (!check.ok) return fail(check.replay ? "two-factor code already used" : "two-factor code");
    try {
      await setAppSetting(settingKey, { counter: check.counter, at: new Date().toISOString() });
    } catch (err) {
      console.error("Could not save the two-factor replay marker", err);
      return res.status(503).json({ error: "Sign-in is temporarily unavailable. Try again shortly." });
    }
    mfa = true;
  }

  try {
    createAdminSession(res, identity, { mfa });
  } catch (err) {
    // Do not expose secret/configuration details to the browser.
    console.error("Could not create the admin session", err);
    return res.status(503).json({ error: "Sign-in is temporarily unavailable. Try again shortly." });
  }
  await recordAuditEvent({ actor: identity.username, action: "admin_login", note: `Signed in as ${identity.role}${mfa ? " with two-factor" : ""} from IP ${key}` });
  return res.status(200).json({ ok: true, role: identity.role, username: identity.username, twoFactor: mfa });
}
