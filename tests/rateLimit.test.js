import { afterEach, describe, expect, it } from "vitest";
import { rateLimit } from "../lib/rateLimit.js";

afterEach(() => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("rate limiting fallback", () => {
  it("still enforces limits when Redis is not configured", async () => {
    const req = {
      headers: { "x-forwarded-for": "198.51.100.10" },
      socket: {},
    };
    const a = await rateLimit(req, { limit: 2, windowMs: 60_000, keySuffix: "test" });
    const b = await rateLimit(req, { limit: 2, windowMs: 60_000, keySuffix: "test" });
    const c = await rateLimit(req, { limit: 2, windowMs: 60_000, keySuffix: "test" });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.retryAfter).toBeGreaterThan(0);
  });
});

// BUG FIX regression: clientKey() used to key on the FIRST hop of
// X-Forwarded-For, which is exactly the part a client fully controls behind
// a standard reverse proxy (the proxy appends the real IP as the LAST hop).
// That let a client defeat every limit by sending a different fake first
// hop on each request. These tests pin the fixed behavior: the trusted last
// hop (or Vercel's tamper-proof header) is what gets rate-limited, not
// whatever the client claims as hop #1.
describe("rate limiting IP-spoofing hardening", () => {
  it("does not let a spoofed first X-Forwarded-For hop bypass the limit", async () => {
    // Same real client (last hop 203.0.113.7, appended by the proxy) sends a
    // different fake first hop on every request, as an attacker would.
    const reqFor = (fakeFirstHop) => ({
      headers: { "x-forwarded-for": `${fakeFirstHop}, 203.0.113.7` },
      socket: {},
    });

    const a = await rateLimit(reqFor("1.1.1.1"), { limit: 2, windowMs: 60_000, keySuffix: "spoof-test" });
    const b = await rateLimit(reqFor("2.2.2.2"), { limit: 2, windowMs: 60_000, keySuffix: "spoof-test" });
    const c = await rateLimit(reqFor("9.9.9.9"), { limit: 2, windowMs: 60_000, keySuffix: "spoof-test" });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    // If the bug were present, each request would look like a new client
    // (a different first hop) and never hit the limit.
    expect(c.allowed).toBe(false);
  });

  it("prefers Vercel's tamper-proof x-vercel-forwarded-for over a client-supplied X-Forwarded-For", async () => {
    const reqFor = (fakeXff) => ({
      headers: {
        "x-vercel-forwarded-for": "203.0.113.55",
        "x-forwarded-for": fakeXff,
      },
      socket: {},
    });

    const a = await rateLimit(reqFor("1.1.1.1"), { limit: 2, windowMs: 60_000, keySuffix: "vercel-test" });
    const b = await rateLimit(reqFor("2.2.2.2"), { limit: 2, windowMs: 60_000, keySuffix: "vercel-test" });
    const c = await rateLimit(reqFor("3.3.3.3"), { limit: 2, windowMs: 60_000, keySuffix: "vercel-test" });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
  });

  it("still separates two genuinely different clients", async () => {
    const req1 = { headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.1" }, socket: {} };
    const req2 = { headers: { "x-forwarded-for": "10.0.0.2, 203.0.113.2" }, socket: {} };

    const a1 = await rateLimit(req1, { limit: 1, windowMs: 60_000, keySuffix: "distinct-test" });
    const a2 = await rateLimit(req2, { limit: 1, windowMs: 60_000, keySuffix: "distinct-test" });

    expect(a1.allowed).toBe(true);
    expect(a2.allowed).toBe(true);
  });
});
