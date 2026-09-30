import { requireAdminPermission } from "../../../lib/adminAuth";
import { listAuditLog } from "../../../lib/auditLog";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  // The log holds admin sign-in IPs and manual-resolution notes, so it is for
  // operators and admins, not read-only viewers.
  if (!requireAdminPermission(req, res, "audit.view")) return;
  try {
    const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 300));
    return res.status(200).json({ entries: await listAuditLog(limit) });
  } catch (err) {
    console.error("Audit log list error", err);
    return res.status(500).json({ error: "Could not load the audit log" });
  }
}
