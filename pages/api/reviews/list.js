import { listPublicReviews } from "../../../lib/reviews";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    return res.status(200).json({ reviews: await listPublicReviews() });
  } catch (err) {
    console.error("Review list error", err);
    return res.status(500).json({ error: "Could not load reviews" });
  }
}
