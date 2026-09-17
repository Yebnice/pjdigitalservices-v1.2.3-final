import { constantTimePasswordMatch, createAdminSession } from "../../../lib/adminAuth";

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function getKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0]).trim() || "unknown";
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const key = getKey(req);
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.startedAt > WINDOW_MS) attempts.set(key, { startedAt: now, count: 0 });
  const state = attempts.get(key);
  if (state.count >= MAX_ATTEMPTS) return res.status(429).json({ error: "Too many login attempts. Try again later." });
  state.count += 1;
  if (!constantTimePasswordMatch(req.body?.password)) return res.status(401).json({ error: "Wrong password." });
  attempts.delete(key);
  createAdminSession(res);
  return res.status(200).json({ ok: true });
}
