import { requireAdminPermission } from "../../../lib/adminAuth";
import { runWorkerCycle } from "../../../lib/workerRun";
import { recordAuditEvent } from "../../../lib/auditLog";

// "Run worker now": the same pass the scheduler does, on demand, with a bigger
// batch. For when the scheduled worker is not running, or after a backlog.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminPermission(req, res, "worker.run");
  if (!actor) return;
  try {
    const { failures, ...summary } = await runWorkerCycle({ batchSize: 10, sweepLimit: 25, trigger: `manual:${actor.username}` });
    await recordAuditEvent({ actor: actor.username, action: "admin_ran_worker", note: `Swept ${summary.sweep?.checked ?? 0} unpaid checkouts, delivered ${summary.results.length}, ${failures.length} step failure(s)` });
    return res.status(200).json({ ...summary, failures });
  } catch (err) {
    console.error("Manual worker run failed", err);
    return res.status(500).json({ error: "The worker run failed" });
  }
}
