import crypto from "crypto";

// Our own customer-facing order number, e.g. PJ-7KQ2M9XA. Separate from the
// Paystack reference (which is what Paystack shows on its dashboard and what the
// payment is matched on). No 0/O/1/I/L so it can be read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 characters
export const ORDER_NO_PATTERN = /^PJ-[A-Z0-9]{8}$|^PJ-L\d{7}$/;

export function generateOrderNo(randomInt = crypto.randomInt) {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return `PJ-${out}`;
}

export function looksLikeOrderNo(value) {
  return ORDER_NO_PATTERN.test(String(value || "").trim().toUpperCase());
}
