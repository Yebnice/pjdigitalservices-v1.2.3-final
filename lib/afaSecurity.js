import crypto from "crypto";

const PREFIX = "v1";
const IV_BYTES = 12;

function getKey() {
  const secret = String(process.env.AFA_ENCRYPTION_KEY || "");
  if (secret.length < 32) {
    throw new Error("AFA_ENCRYPTION_KEY must be set to at least 32 random characters");
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptAfaDetails(value) {
  if (!value || typeof value !== "object") return value;
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptAfaDetails(value) {
  if (!value) return null;
  // Backward compatibility: older rows stored a JSON object. New rows use
  // the v1 encrypted string format.
  if (typeof value === "object") return value;
  const raw = String(value);
  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return null;
  }
  try {
    const key = getKey();
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("Could not decrypt AFA details:", error?.message || error);
    return null;
  }
}
