import { isAdminAuthed } from "../../../lib/adminAuth";
import { getWalletBalance } from "../../../lib/techlink";

// Every order this app fulfills debits the business's own Techlink wallet
// (paymentMethod: "wallet" — see lib/techlink.js). Paystack has already
// charged the customer by the time an order reaches fulfillment, so a dry
// Techlink wallet doesn't stop customers being charged — it just makes
// fulfillment start failing, silently, order after order, until someone
// notices. This endpoint powers a dashboard warning so that's caught early.
//
// The Postman docs for GET /wallet/balance don't show a response body, so
// this reads defensively across the field names Techlink uses elsewhere
// for balances ("balance", "walletBalance", "newBalance").
export default async function handler(req, res) {
  if (!isAdminAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const data = await getWalletBalance();
    const balance = data?.balance ?? data?.walletBalance ?? data?.newBalance ?? null;
    if (balance == null) {
      // Techlink responded, but not with a field name we recognize — surface
      // the raw payload rather than silently showing nothing, so whoever's
      // looking can update the field-name list above from a real response.
      return res.status(200).json({ balance: null, raw: data });
    }
    return res.status(200).json({ balance: Number(balance) });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Could not reach Techlink" });
  }
}
