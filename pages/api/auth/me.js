import { getAuthedCustomer } from "../../../lib/customerAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const customer = await getAuthedCustomer(req);
    return res.status(200).json({ customer });
  } catch (err) {
    console.error("Get current customer error", err);
    return res.status(200).json({ customer: null });
  }
}
