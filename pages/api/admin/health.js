import { requireAdminPermission } from "../../../lib/adminAuth";
import { getAppSetting } from "../../../lib/appSettings";
import { getWebhookQueueStats } from "../../../lib/paystackWebhookQueue";
import { listStalePendingOrders } from "../../../lib/store";
import { WORKER_HEARTBEAT_KEY } from "../../../lib/workerRun";

// Is the machinery that turns a Paystack payment into a delivery actually
// running? Each check is independent and reports its own failure.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "system.view")) return;
  const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, error: err.message }; } };
  const [heartbeat, webhooks, unpaid] = await Promise.all([
    attempt(() => getAppSetting(WORKER_HEARTBEAT_KEY)),
    attempt(() => getWebhookQueueStats()),
    attempt(() => listStalePendingOrders({ olderThanMinutes: 10, newerThanDays: 30, limit: 200 })),
  ]);
  res.setHeader("Cache-Control", "no-store");
  const hb = heartbeat.ok ? heartbeat.value : null;
  return res.status(200).json({
    worker: {
      known: heartbeat.ok,
      error: heartbeat.ok ? null : heartbeat.error,
      lastRunAt: hb?.at || null,
      lastRunOk: hb?.ok ?? null,
      failedSteps: hb?.failedSteps || [],
      trigger: hb?.trigger || null,
      ageMinutes: hb?.at ? Math.max(0, Math.round((Date.now() - new Date(hb.at).getTime()) / 60000)) : null,
    },
    webhooks: webhooks.ok ? webhooks.value : { error: webhooks.error },
    unpaidCheckouts: unpaid.ok ? unpaid.value.length : null,
  });
}
