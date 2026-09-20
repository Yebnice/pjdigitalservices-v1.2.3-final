import { isAdminAuthed } from "../../../lib/adminAuth";
import { listAuditLog } from "../../../lib/auditLog";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.status(200).json({ entries: await listAuditLog() });
  } catch (err) {
    console.error("Audit log list error", err);
    return res.status(500).json({ error: "Could not load the audit log" });
  }
}
