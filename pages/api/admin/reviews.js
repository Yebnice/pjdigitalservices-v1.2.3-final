import { isAdminAuthed } from "../../../lib/adminAuth";
import { listAllReviews, setReviewHidden } from "../../../lib/reviews";
import { recordAuditEvent } from "../../../lib/auditLog";

export default async function handler(req, res) {
  if (!isAdminAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
  if (req.method === "GET") {
    try {
      return res.status(200).json({ reviews: await listAllReviews() });
    } catch (err) {
      console.error("Admin review list error", err);
      return res.status(500).json({ error: "Could not load reviews" });
    }
  }
  if (req.method === "POST") {
    try {
      const { id, isHidden } = req.body || {};
      if (!id || typeof isHidden !== "boolean") return res.status(400).json({ error: "id and isHidden are required" });
      const review = await setReviewHidden(id, isHidden);
      await recordAuditEvent({ action: isHidden ? "review_hidden" : "review_unhidden", reference: review?.orderReference || id });
      return res.status(200).json({ review });
    } catch (err) {
      console.error("Admin review moderation error", err);
      return res.status(500).json({ error: "Could not update the review" });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}
