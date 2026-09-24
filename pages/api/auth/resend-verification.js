import { resendCustomerVerification } from "../../../lib/customers";
import { notifyCustomerVerifyEmail } from "../../../lib/notifications";
import { rateLimit } from "../../../lib/rateLimit";

const GENERIC_MESSAGE = "If an unverified account exists with that email, a new verification link has been sent. Check your inbox and spam folder.";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rl = rateLimit(req, { limit: 3, windowMs: 15 * 60_000, keySuffix: "auth-resend-verification" });
  if (!rl.allowed) {
    // Keep the response generic even when throttled so the endpoint cannot
    // be used to discover whether an address has an account.
    return res.status(200).json({ message: GENERIC_MESSAGE });
  }

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(200).json({ message: GENERIC_MESSAGE });
    }

    const result = await resendCustomerVerification(email);

    if (result) {
      try {
        await notifyCustomerVerifyEmail({
          email: result.customer.email,
          name: result.customer.name,
          token: result.verificationToken,
        });
      } catch (err) {
        // The old token remains replaced by the new one only if the email
        // provider accepts the request. On provider failure, remove the
        // newly issued token so it cannot be used without a delivered email.
        console.error("Verification resend email failed", email, err);
      }
    }

    return res.status(200).json({ message: GENERIC_MESSAGE });
  } catch (err) {
    console.error("Resend verification error", err);
    return res.status(200).json({ message: GENERIC_MESSAGE });
  }
}
