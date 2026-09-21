import crypto from "crypto";

// Uses Node's built-in scrypt rather than adding a new npm dependency —
// scrypt is a well-established, deliberately slow key-derivation function
// designed for exactly this (resists brute-forcing far better than a plain
// hash like SHA-256 would). A random salt per password means two users
// with the same password never produce the same stored value.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedBuffer = crypto.scryptSync(String(password), salt, 64);
  return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}
