import { requireAdminRole } from "../../../lib/adminAuth";
import { updateFeedbackStatus } from "../../../lib/feedback";
import { recordAuditEvent } from "../../../lib/auditLog";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
  try {
    const { id, status, note } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: "id and status are required" });
    const feedback = await updateFeedbackStatus(id, status);
    await recordAuditEvent({ actor: actor.username, action: `feedback_status_${status}`, reference: feedback?.caseReference || id, note: note || null });
    return res.status(200).json({ feedback });
  } catch (err) {
    console.error("Feedback status update error", err);
    return res.status(400).json({ error: err.message });
  }
}
