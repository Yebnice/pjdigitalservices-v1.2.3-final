import { adminSessionActor } from "../../../lib/adminAuth";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = adminSessionActor(req);
  return res.status(200).json({
    authenticated: Boolean(actor),
    role: actor?.role || null,
    username: actor?.username || null,
  });
}
