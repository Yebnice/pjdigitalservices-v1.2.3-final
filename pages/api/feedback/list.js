import { listFeedback } from "../../../lib/feedback";
import { requireAdminRole } from "../../../lib/adminAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminRole(req, res, ["viewer"])) return;
  try {
    res.status(200).json({ feedback: await listFeedback() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
