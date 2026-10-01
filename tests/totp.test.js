import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, totpCounter, verifyTotp } from "../lib/totp.js";

// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890").
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it("matches the official test vectors", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    for (const [time, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]]) {
      expect(totpCode(SECRET, Math.floor(time / 30))).toBe(code);
    }
  });

  it("round-trips base32 and generates 160-bit secrets", () => {
    for (let i = 0; i < 20; i += 1) {
      const s = generateTotpSecret();
      expect(s.length).toBe(32);
      expect(base32Encode(base32Decode(s))).toBe(s);
    }
  });

  it("accepts one step either side of now and no more", () => {
    const now = 1234567890000;
    const at = (o) => totpCode(SECRET, totpCounter(now) + o);
    for (const o of [-1, 0, 1]) expect(verifyTotp(SECRET, at(o), { now }).ok).toBe(true);
    for (const o of [-2, 2]) expect(verifyTotp(SECRET, at(o), { now }).ok).toBe(false);
  });

  it("makes every code single-use, including older ones", () => {
    const now = 1234567890000;
    const first = verifyTotp(SECRET, totpCode(SECRET, totpCounter(now)), { now });
    expect(first.ok).toBe(true);
    const again = verifyTotp(SECRET, totpCode(SECRET, totpCounter(now)), { now, lastUsedCounter: first.counter });
    expect(again.ok).toBe(false);
    expect(again.replay).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, totpCounter(now) - 1), { now, lastUsedCounter: first.counter }).ok).toBe(false);
    expect(verifyTotp(SECRET, totpCode(SECRET, totpCounter(now) + 1), { now, lastUsedCounter: first.counter }).ok).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    const now = 1234567890000;
    for (const bad of ["", "12345", "1234567", "abcdef", null, undefined]) expect(verifyTotp(SECRET, bad, { now }).ok).toBe(false);
    expect(verifyTotp("!!!not base32!!!", "123456", { now }).ok).toBe(false);
  });

  it("builds the link authenticator apps expect", () => {
    const uri = otpauthUri({ secret: SECRET, account: "kofi" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${SECRET}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
