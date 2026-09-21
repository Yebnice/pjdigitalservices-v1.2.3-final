import { clearCustomerSession } from "../../../lib/customerAuth";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  clearCustomerSession(res);
  return res.status(200).json({ ok: true });
}
