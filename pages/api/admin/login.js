import { authenticateAdmin, createAdminSession } from "../../../lib/adminAuth";
import { recordAuditEvent } from "../../../lib/auditLog";
import { rateLimit } from "../../../lib/rateLimit";

const WINDOW_MS = 10 * 60 * 1000;

function getKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0]).trim() || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const limit = await rateLimit(req, { limit: 10, windowMs: WINDOW_MS, keySuffix: "admin-login" });
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return res.status(429).json({ error: "Too many login attempts. Try again later." });
  }

  const key = getKey(req);
  const identity = authenticateAdmin(req.body?.username, req.body?.password);
  if (!identity) return res.status(401).json({ error: "Invalid admin credentials." });

  try {
    createAdminSession(res, identity);
  } catch (err) {
    console.error("Admin login: could not create session —", err.message);
    return res.status(500).json({ error: "Server misconfigured: ADMIN_SESSION_SECRET is missing or invalid. Set a random string of 32+ characters in your environment variables and redeploy." });
  }

  await recordAuditEvent({
    actor: identity.username,
    action: "admin_login",
    note: `Admin ${identity.username} signed in from IP ${key}`,
  });

  return res.status(200).json({
    ok: true,
    role: identity.role,
    username: identity.username,
  });
}
