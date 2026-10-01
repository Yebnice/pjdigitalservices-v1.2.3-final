import { rateLimit } from "../../../lib/rateLimit";
import { createFeedback } from "../../../lib/feedback";
import { notifyAdminNewFeedback } from "../../../lib/notifications";
import { isValidGhanaNumber, toLocalGhanaNumber } from "../../../lib/networkValidation";

// Every text field is capped, and must be a string, so a direct API call can't
// bloat the table (or crash the handler by sending an object where text belongs).
const FIELD_LIMITS = {
  name: 100, email: 254, phone: 20, orderReference: 60, category: 40, message: 3000,
  serviceType: 40, transactionId: 100, requestedData: 200, beneficiary: 100,
  transactionAt: 40, transactionDetails: 2000,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 5, windowMs: 60_000, keySuffix: "feedback" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please wait a moment and try again." });
  try {
    const {
      name, email, phone, orderReference, category, message,
      serviceType, transactionId, transactionAmount, requestedData, beneficiary, transactionAt, transactionDetails
    } = req.body || {};
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      const value = req.body?.[field];
      if (value != null && (typeof value !== "string" || value.length > max)) {
        return res.status(400).json({ error: `"${field}" is invalid or too long` });
      }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (!name || !message || !serviceType || (!email && !phone)) {
      return res.status(400).json({ error: "Name, service/product, message, and at least an email or phone number are required" });
    }
    const amountNumber = transactionAmount === "" || transactionAmount == null ? null : Number(transactionAmount);
    if (amountNumber !== null && (!Number.isFinite(amountNumber) || amountNumber < 0)) {
      return res.status(400).json({ error: "Enter a valid transaction amount" });
    }
    const normalizedService = String(serviceType).trim().toLowerCase();
    const isDataOrAirtime = normalizedService === "data" || normalizedService === "airtime";
    const missing = [];
    if (!transactionId?.trim()) missing.push("Transaction ID");
    if (amountNumber === null) missing.push("Amount");
    if (isDataOrAirtime && !requestedData?.trim()) missing.push("Data requested / airtime requested");
    if (isDataOrAirtime && !beneficiary?.trim()) missing.push("Recipient / beneficiary");
    if (!transactionAt) missing.push("Transaction date and time");
    else if (Number.isNaN(Date.parse(transactionAt))) {
      return res.status(400).json({ error: "Enter a valid transaction date and time" });
    }
    if (!transactionDetails?.trim()) missing.push("Transaction details");
    if (missing.length) {
      return res.status(400).json({ error: `Please provide: ${missing.join(", ")}.` });
    }
    const entry = await createFeedback({ name, email: email ? email.trim().toLowerCase() : email, phone: phone && isValidGhanaNumber(phone) ? toLocalGhanaNumber(phone) : phone, orderReference, category: category || "general", message, serviceType: normalizedService, transactionId, transactionAmount: amountNumber, requestedData, beneficiary, transactionAt, transactionDetails });
    // Best-effort: previously nothing notified admin at all when a
    // complaint came in — it just sat silently in the database. A failure
    // here must never stop the customer from seeing their case was saved.
    try {
      await notifyAdminNewFeedback(entry);
    } catch (err) {
      console.error("Admin feedback notification failed", entry.caseReference, err);
    }
    res.status(200).json({ feedback: entry });
  } catch (err) {
    // Log the real error for us to debug, but never hand a raw internal
    // error message (a database constraint name, a stack fragment) to the
    // customer — they just need a plain, safe message here.
    console.error("Feedback submission error", err);
    res.status(500).json({ error: "Something went wrong saving your feedback. Please try again in a moment." });
  }
}
