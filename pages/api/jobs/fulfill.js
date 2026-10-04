import crypto from "crypto";
import { isAdminAuthed } from "../../../lib/adminAuth";
import { runWorkerCycle } from "../../../lib/workerRun";

// Keep the worker endpoint within the same 60-second execution contract
// previously configured in vercel.json, without relying on a fragile
// project-level function matcher.
export const config = { maxDuration: 60 };

// Constant-time comparison so the worker secret can't be guessed byte-by-byte
// from response timing.
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && safeEqual(req.headers.authorization, `Bearer ${secret}`)) return true;
  // isAdminAuthed can throw (e.g. ADMIN_SESSION_SECRET missing). That must
  // read as "not authorized", never as an unhandled 500.
  try {
    return isAdminAuthed(req);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const batchSize = Math.max(1, Math.min(100, Number(process.env.FULFILLMENT_BATCH_SIZE || 3)));
    const sweepLimit = Math.max(0, Math.min(50, Number(process.env.SWEEP_BATCH_SIZE || 8)));
    const { failures, ...summary } = await runWorkerCycle({ batchSize, sweepLimit, trigger: "schedule" });
    // Do all the work first, then report. A non-2xx status makes the GitHub
    // Actions worker (curl --fail) go red, so a broken step is never silent.
    const status = failures.length ? 500 : 200;
    return res.status(status).json({ ...(failures.length ? { error: "One or more worker steps failed", failures } : {}), ...summary });
  } catch (err) {
    console.error("Fulfillment worker error", err);
    return res.status(500).json({ error: "Fulfillment worker failed" });
  }
}
