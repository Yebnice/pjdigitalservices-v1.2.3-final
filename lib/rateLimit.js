import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

const buckets = new Map();
const limiters = new Map();

// BUG FIX: this used to take the FIRST address in X-Forwarded-For. On
// Vercel (and any standard reverse-proxy setup) that header is built by
// APPENDING the real connecting IP to whatever the client already sent —
// so the first entry is exactly the part a client fully controls. A
// request could carry `X-Forwarded-For: 1.2.3.4` and Vercel would forward
// it as `1.2.3.4, <real client IP>`; taking forwarded[0] used the attacker
// -supplied value, so anyone could defeat every rate limit and login
// throttle in this app (and forge the "signed in from IP" audit-log note)
// just by sending a different fake first hop on each request. Vercel's own
// edge-injected header, x-vercel-forwarded-for, cannot be overridden by the
// client (Vercel strips/ignores a client-sent copy of it), so prefer that.
// Falling back to the LAST hop of a generic X-Forwarded-For (rather than
// the first) is the standard mitigation when running behind exactly one
// trusted proxy, since that's the hop the proxy itself appended.
function clientKey(req) {
  const trustedVercelIp = req.headers["x-vercel-forwarded-for"];
  if (trustedVercelIp) {
    const first = (Array.isArray(trustedVercelIp) ? trustedVercelIp[0] : String(trustedVercelIp)).split(",")[0].trim();
    if (first) return first;
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const parts = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded)).split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  const realIp = req.headers["x-real-ip"];
  return String(realIp || "").trim() || req.socket?.remoteAddress || "unknown";
}

function memoryRateLimit(req, { limit, windowMs, keySuffix }) {
  const key = `${keySuffix}:${clientKey(req)}`;
  const now = Date.now();

  if (buckets.size > 5000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count <= limit) return { allowed: true, retryAfter: 0 };

  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function getRedisClient() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return new Redis({
    url,
    token,
    enableTelemetry: false,
  });
}

function getLimiter(limit, windowMs, keySuffix, redis) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const cacheKey = `${limit}:${windowSeconds}:${keySuffix}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: `@pjdigitalservices/ratelimit:${keySuffix || "default"}`,
    analytics: false,
  });

  limiters.set(cacheKey, limiter);
  return limiter;
}

function identifier(req, keySuffix) {
  const source = `${keySuffix}:${clientKey(req)}`;
  return createHash("sha256").update(source).digest("hex");
}

export async function rateLimit(req, { limit = 20, windowMs = 60_000, keySuffix = "" } = {}) {
  const redis = getRedisClient();

  if (!redis) {
    return memoryRateLimit(req, { limit, windowMs, keySuffix });
  }

  try {
    const limiter = getLimiter(limit, windowMs, keySuffix, redis);
    const result = await limiter.limit(identifier(req, keySuffix));

    return {
      allowed: Boolean(result.success),
      retryAfter: result.success
        ? 0
        : Math.max(1, Math.ceil((Number(result.reset) - Date.now()) / 1000)),
    };
  } catch (error) {
    console.error("Distributed rate-limit error; using local fallback:", error?.message || error);
    return memoryRateLimit(req, { limit, windowMs, keySuffix });
  }
}
