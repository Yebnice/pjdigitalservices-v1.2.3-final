import crypto from "crypto";
import { ROLE_RANK, normalizeRole, roleHas } from "./adminPermissions";
import { base32Decode } from "./totp";

const COOKIE_NAME = "pj_admin_session";
const TTL_SECONDS = 60 * 60 * 8; // 8 hours

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set and be at least 32 characters");
  }
  if (secret === process.env.CUSTOMER_SESSION_SECRET) {
    throw new Error("ADMIN_SESSION_SECRET and CUSTOMER_SESSION_SECRET must be different values");
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(`pj-admin-session-v1:${payload}`).digest("base64url");
}

// Returns { users, invalid }. `invalid` is true when ADMIN_USERS_JSON is set to
// something that isn't a JSON array. In that case logins must be refused: the
// old behaviour (silently fall back to the single shared ADMIN_PASSWORD) meant
// a typo in the role-based accounts config quietly re-enabled shared-password
// admin access.
function configuredAdminUsers() {
  const raw = process.env.ADMIN_USERS_JSON;
  if (!raw || !String(raw).trim()) return { users: [], invalid: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { users: parsed, invalid: false };
  } catch {
    // fall through
  }
  console.error("ADMIN_USERS_JSON is set but is not a valid JSON array; admin login is disabled until it is fixed.");
  return { users: [], invalid: true };
}

// Used to burn the same scrypt time when the username does not exist, so
// response time does not reveal which usernames are real.
const DUMMY_SALT = "pj-admin-dummy-salt";

export function authenticateAdmin(username, password) {
  const { users, invalid } = configuredAdminUsers();
  if (invalid) return null;
  if (users.length) {
    const cleanUser = String(username || "").trim().toLowerCase();
    const user = users.find((item) => String(item.username || "").trim().toLowerCase() === cleanUser);
    const [salt, stored] = String(user?.passwordHash || "").split("$");
    if (!user || user.disabled === true || !salt || !stored) {
      crypto.scryptSync(String(password || ""), DUMMY_SALT, 32);
      return null;
    }
    const derived = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
    const a = Buffer.from(derived, "hex");
    const b = Buffer.from(stored, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (!ROLE_RANK[String(user.role || "").trim().toLowerCase()]) {
      console.warn(`Admin user "${cleanUser}" has a missing or unknown role in ADMIN_USERS_JSON; treating as viewer.`);
    }
    return { username: cleanUser, role: normalizeRole(user.role) };
  }
  return constantTimePasswordMatch(password) ? { username: "admin", role: "admin" } : null;
}

// ---- Two-factor (TOTP) configuration ----
// Per-user secret in ADMIN_USERS_JSON ("totpSecret"), or ADMIN_TOTP_SECRET for
// the single shared login. ADMIN_REQUIRE_2FA=true makes it mandatory: anyone
// without a secret cannot sign in at all.
export function adminMode() {
  return configuredAdminUsers().users.length ? "accounts" : "shared";
}

export function twoFactorRequired() {
  return String(process.env.ADMIN_REQUIRE_2FA || "").trim().toLowerCase() === "true";
}

export function totpSecretFor(identity) {
  const { users } = configuredAdminUsers();
  let secret = "";
  if (users.length) {
    const name = String(identity?.username || "").trim().toLowerCase();
    const user = users.find((item) => String(item.username || "").trim().toLowerCase() === name);
    secret = String(user?.totpSecret || "");
  } else {
    secret = String(process.env.ADMIN_TOTP_SECRET || "");
  }
  secret = secret.replace(/[\s-]/g, "").toUpperCase();
  if (!secret) return "";
  try {
    return base32Decode(secret).length >= 10 ? secret : "";
  } catch {
    // A secret that is set but unreadable must not quietly turn 2FA off for
    // this account: treat it as "2FA required, cannot be satisfied".
    console.error(`Two-factor secret for "${identity?.username}" is not valid base32; sign-in is disabled for it until fixed.`);
    return "INVALID";
  }
}

// A signed cookie proves the session was ISSUED by this server; it does not
// prove the account still exists or still has the same role. Every request is
// re-checked against the current configuration, so removing a user, disabling
// them, or lowering their role in ADMIN_USERS_JSON takes effect on their next
// request instead of when their 8-hour cookie expires. (To end every session
// at once, change ADMIN_SESSION_SECRET.)
function currentIdentityFor(claimed) {
  const { users, invalid } = configuredAdminUsers();
  if (invalid) return null;
  const name = String(claimed?.username || "").trim().toLowerCase();
  if (users.length) {
    const user = users.find((item) => String(item.username || "").trim().toLowerCase() === name);
    if (!user || user.disabled === true || !user.passwordHash) return null;
    return { username: name, role: normalizeRole(user.role) };
  }
  // Shared-password mode has exactly one identity.
  return name === "admin" ? { username: "admin", role: "admin" } : null;
}

export function adminSessionActor(req) {
  const cookieHeader = req.headers.cookie || "";
  // decodeURIComponent throws on malformed input (e.g. a stray "%"); a bad
  // cookie must mean "no session", not an unhandled error.
  const safeDecode = (value) => {
    try { return decodeURIComponent(value); } catch { return ""; }
  };
  const cookies = Object.fromEntries(cookieHeader.split(";").map((part) => {
    const i = part.indexOf("=");
    return i === -1 ? [part.trim(), ""] : [part.slice(0, i).trim(), safeDecode(part.slice(i + 1).trim())];
  }));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!(data.exp > Math.floor(Date.now() / 1000))) return null;
    if (data.typ !== "admin" || typeof data.username !== "string" || !data.username) return null;
    const identity = currentIdentityFor({ username: data.username });
    if (!identity) return null;
    // Turning two-factor on (for this account, or for everyone with
    // ADMIN_REQUIRE_2FA) must also end sessions that were opened without it.
    const needsSecond = Boolean(totpSecretFor(identity)) || twoFactorRequired();
    if (needsSecond && data.mfa !== true) return null;
    return data.mfa === true ? { ...identity, mfa: true } : identity;
  } catch {
    return null;
  }
}

export function createAdminSession(res, identity = { username: "admin", role: "admin" }, { mfa = false } = {}) {
  const payload = Buffer.from(JSON.stringify({
    typ: "admin",
    username: identity.username || "admin",
    role: identity.role || "admin",
    ...(mfa ? { mfa: true } : {}),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure}`);
}

export function clearAdminSession(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function isAdminAuthed(req) {
  return Boolean(adminSessionActor(req));
}

export function constantTimePasswordMatch(value) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(String(value || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


export function adminHasRole(req, allowedRoles = ["admin"]) {
  const actor = adminSessionActor(req);
  if (!actor) return false;
  const rank = ROLE_RANK[normalizeRole(actor.role)] || 0;
  return allowedRoles.some((role) => rank >= (ROLE_RANK[String(role).toLowerCase()] || 99));
}

// Browsers attach an Origin header to cross-site POSTs. The session cookie is
// SameSite=Lax, which already blocks most cross-site requests; this is a second
// layer so a state-changing admin request from another site is refused even if
// a browser's cookie handling ever differs. Requests with no Origin at all
// (curl, server-to-server, same-origin GETs) are unaffected.
export function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
      return new URL(String(origin)).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  return String(req.headers["sec-fetch-site"] || "same-origin").toLowerCase() !== "cross-site";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireAdminRole(req, res, allowedRoles = ["admin"]) {
  const actor = adminSessionActor(req);
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!SAFE_METHODS.has(String(req.method || "GET").toUpperCase()) && !isSameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin request blocked" });
    return null;
  }
  if (!adminHasRole(req, allowedRoles)) {
    res.status(403).json({ error: "Insufficient admin permissions" });
    return null;
  }
  return actor;
}

// Same checks, but named by what the person is trying to do (see
// lib/adminPermissions.js) instead of by a hard-coded role.
export function requireAdminPermission(req, res, permission) {
  const actor = adminSessionActor(req);
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!SAFE_METHODS.has(String(req.method || "GET").toUpperCase()) && !isSameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin request blocked" });
    return null;
  }
  if (!roleHas(actor.role, permission)) {
    res.status(403).json({ error: "Insufficient admin permissions" });
    return null;
  }
  return actor;
}
