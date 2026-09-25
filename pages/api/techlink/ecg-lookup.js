import { rateLimit } from "../../../lib/rateLimit";
import { lookupEcgMeter } from "../../../lib/techlink";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 20, windowMs: 60_000, keySuffix: "techlink-ecg-lookup" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please try again shortly." });

  const { meter } = req.query;
  if (!meter) return res.status(400).json({ error: "meter is required" });
  try {
    const data = await lookupEcgMeter({ meter });
    res.status(200).json(data);
  } catch (err) {
    console.error("Techlink ECG lookup error", err);
    const status = Number(err?.status);
    if (status === 404) {
      return res.status(404).json({ error: "No ECG account matched that meter." });
    }
    if (status === 400) {
      return res.status(400).json({ error: "The ECG meter number is not valid." });
    }
    return res.status(502).json({ error: "ECG lookup is temporarily unavailable. Please try again shortly." });
  }
}
