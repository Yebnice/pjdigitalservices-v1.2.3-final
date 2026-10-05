import crypto from "crypto";
import { findCustomerRowById, toPublicCustomer } from "./customers";

const COOKIE_NAME = "pj_customer_session";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — a consumer storefront login, not a banking session

function getSecret() {
  const secret = process.env.CUSTOMER_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("CUSTOMER_SESSION_SECRET must be set and be at least 32 characters");
  }
  if (secret === process.env.ADMIN_SESSION_SECRET) {
    throw new Error("CUSTOMER_SESSION_SECRET and ADMIN_SESSION_SECRET must be different values");
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(`pj-customer-session-v1:${payload}`).digest("base64url");
}

function verify(token) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Fail closed: a token with no (or a non-numeric) expiry is never valid.
    if (!(Number(data.exp) > Math.floor(Date.now() / 1000))) return null;
    if (data.typ !== "customer") return null;
    return data;
  } catch {
    return null;
  }
}

// A short fingerprint of the customer's current password hash. It is stored in
// the session, so changing/resetting the password makes every older session
// stop working (a stolen cookie doesn't survive a password reset).
export function passwordStamp(passwordHash) {
  return crypto.createHmac("sha256", getSecret()).update(`pv:${passwordHash || ""}`).digest("hex").slice(0, 24);
}

export function createCustomerSession(res, customerId, passwordHash) {
  const payload = Buffer.from(JSON.stringify({
    typ: "customer",
    sub: customerId,
    pv: passwordStamp(passwordHash),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure}`);
}

export function clearCustomerSession(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return ""; // a malformed cookie must not crash the request
  }
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = Object.fromEntries(cookieHeader.split(";").map((part) => {
    const i = part.indexOf("=");
    return i === -1 ? [part.trim(), ""] : [part.slice(0, i).trim(), safeDecode(part.slice(i + 1).trim())];
  }));
  return verify(cookies[COOKIE_NAME]);
}

// Cookie check only (no database). Prefer getAuthedCustomer() for anything
// that reads or returns account data.
export function getAuthedCustomerId(req) {
  return readSession(req)?.sub || null;
}

// Full check: valid signature + unexpired + the account still exists + the
// password hasn't changed since this session was issued.
export async function getAuthedCustomer(req) {
  const data = readSession(req);
  if (!data?.sub || !data.pv) return null;
  const row = await findCustomerRowById(data.sub);
  if (!row) return null;
  const expected = Buffer.from(passwordStamp(row.password_hash));
  const given = Buffer.from(String(data.pv));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return toPublicCustomer(row);
}
