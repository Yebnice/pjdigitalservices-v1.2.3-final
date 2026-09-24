import crypto from "crypto";

const COOKIE_NAME = "pj_admin_session";
const TTL_SECONDS = 60 * 60 * 8; // 8 hours

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set and be at least 32 characters");
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function verify(token) {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}


function configuredAdminUsers() {
  try {
    const raw = process.env.ADMIN_USERS_JSON;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function authenticateAdmin(username, password) {
  const users = configuredAdminUsers();
  if (users.length) {
    const cleanUser = String(username || "").trim().toLowerCase();
    const user = users.find((item) => String(item.username || "").trim().toLowerCase() === cleanUser);
    if (!user?.passwordHash) return null;
    const [salt, stored] = String(user.passwordHash).split("$");
    if (!salt || !stored) return null;
    const derived = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
    const a = Buffer.from(derived, "hex");
    const b = Buffer.from(stored, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { username: cleanUser, role: String(user.role || "admin") };
  }
  return constantTimePasswordMatch(password) ? { username: "admin", role: "admin" } : null;
}

export function adminSessionActor(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = Object.fromEntries(cookieHeader.split(";").map((part) => {
    const i = part.indexOf("=");
    return i === -1 ? [part.trim(), ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
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
    return data.exp > Math.floor(Date.now() / 1000) ? { username: data.username || "admin", role: data.role || "admin" } : null;
  } catch {
    return null;
  }
}

export function createAdminSession(res, identity = { username: "admin", role: "admin" }) {
  const payload = Buffer.from(JSON.stringify({
    username: identity.username || "admin",
    role: identity.role || "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure}`);
}

export function clearAdminSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
