import { getAuthedCustomerId } from "../../../lib/customerAuth";
import { findCustomerById } from "../../../lib/customers";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const id = getAuthedCustomerId(req);
  if (!id) return res.status(200).json({ customer: null });
  try {
    const customer = await findCustomerById(id);
    return res.status(200).json({ customer });
  } catch (err) {
    console.error("Get current customer error", err);
    return res.status(200).json({ customer: null });
  }
}
