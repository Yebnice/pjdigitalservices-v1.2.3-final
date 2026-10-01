import crypto from "crypto";

// Time-based one-time passwords (RFC 6238, the standard used by Google
// Authenticator, Microsoft Authenticator, Authy, 1Password and friends),
// built on Node's crypto so no new dependency is needed.
//
// SHA-1, 6 digits and a 30-second step are what every authenticator app
// assumes, so they are fixed here rather than configurable.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character in two-factor secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 160 bits, the size RFC 4226 recommends.
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCounter(now = Date.now()) {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

// Returns { ok, counter }. `window` accepts codes from one step either side so
// a phone clock a few seconds out still works. `lastUsedCounter` makes each
// code single-use: a code (or any earlier one) that has already signed
// someone in is refused, so a shoulder-surfed or intercepted code is useless.
export function verifyTotp(secret, submitted, { now = Date.now(), window = 1, lastUsedCounter = null } = {}) {
  const code = String(submitted || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, counter: null };
  let key;
  try { key = base32Decode(secret); } catch { return { ok: false, counter: null }; }
  if (!key.length) return { ok: false, counter: null };
  const current = totpCounter(now);
  let matched = null;
  // Check every step in the window without stopping early, so timing does not
  // reveal which step matched.
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    const expected = Buffer.from(totpCode(secret, counter));
    const given = Buffer.from(code);
    if (crypto.timingSafeEqual(expected, given) && matched == null) matched = counter;
  }
  if (matched == null) return { ok: false, counter: null };
  if (lastUsedCounter != null && matched <= Number(lastUsedCounter)) return { ok: false, counter: matched, replay: true };
  return { ok: true, counter: matched };
}

export function otpauthUri({ secret, account, issuer = "PjDigitalServices Admin" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
