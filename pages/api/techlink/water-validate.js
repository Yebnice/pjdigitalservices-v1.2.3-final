import { rateLimit } from "../../../lib/rateLimit";
import { validateWaterMeter } from "../../../lib/techlink";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 20, windowMs: 60_000, keySuffix: "techlink-water-validate" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please try again shortly." });

  const { account, phone } = req.body;
  if (!account) return res.status(400).json({ error: "account is required" });

  try {
    const data = await validateWaterMeter({ account, phone });
    return res.status(200).json(data);
  } catch (err) {
    console.error("Techlink Water validation error", err);
    const status = Number(err?.status);
    if (status === 404) return res.status(404).json({ error: "No Ghana Water account matched that number." });
    if (status === 400) return res.status(400).json({ error: "The Ghana Water account number is not valid." });
    return res.status(502).json({ error: "Ghana Water validation is temporarily unavailable. Please try again shortly." });
  }
}
