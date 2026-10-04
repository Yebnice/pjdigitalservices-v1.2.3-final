import { requireAdminPermission } from "../../../lib/adminAuth";
import { runOutstandingCheck } from "../../../lib/workerRun";
import { recordAuditEvent } from "../../../lib/auditLog";

// Keep the admin worker endpoint within the previous 60-second execution
// contract without depending on project-level function path matching.
export const config = { maxDuration: 60 };

// "Check outstanding orders": asks Paystack about old unpaid checkouts, records
// what it finds, and shows what NEEDS ATTENTION. It sends NOTHING to Techlink
// (deliveries is always 0); every delivery from here on is an explicit decision
// made on the Needs attention tab. (This button used to run the full delivery
// worker, which is how orders could reach Techlink without anyone approving them.)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminPermission(req, res, "worker.run");
  if (!actor) return;
  try {
    const summary = await runOutstandingCheck({ sweepLimit: 25 });
    await recordAuditEvent({
      actor: actor.username,
      action: "admin_checked_outstanding_orders",
      note: `Checked ${summary.checked} unpaid checkout(s): ${summary.paidHeld} paid and held for approval, ${summary.closed} closed, ${summary.stillPending} still open, ${summary.rejected} rejected, ${summary.errors} error(s). Deliveries: 0. Needs attention now: ${summary.needsAttentionTotal}.`,
    });
    // `results` is kept (always empty) so older dashboards that read it keep working.
    return res.status(200).json({ sweep: summary, ...summary, results: [], failures: summary.errors ? [{ step: "outstanding-check", error: `${summary.errors} checkout(s) could not be verified with Paystack` }] : [] });
  } catch (err) {
    console.error("Outstanding-orders check failed", err);
    return res.status(500).json({ error: "The outstanding-orders check failed" });
  }
}
