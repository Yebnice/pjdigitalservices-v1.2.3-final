export async function rateLimit() { return { allowed: true, retryAfter: 0 }; }
export function rateLimitBackend() { return "redis"; }
