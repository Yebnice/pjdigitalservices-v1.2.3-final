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
