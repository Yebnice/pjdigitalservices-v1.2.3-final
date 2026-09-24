import { resendCustomerVerification, revokeCustomerVerificationToken } from "../../../lib/customers";
import { notifyCustomerVerifyEmail } from "../../../lib/notifications";
import { rateLimit } from "../../../lib/rateLimit";

const GENERIC_MESSAGE = "If an unverified account exists with that email, a new verification link has been sent. Check your inbox and spam folder.";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rl = await rateLimit(req, { limit: 3, windowMs: 15 * 60_000, keySuffix: "auth-resend-verification" });
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
        try {
          await revokeCustomerVerificationToken(result.verificationToken);
        } catch (revokeErr) {
          console.error("Could not revoke failed verification token", revokeErr);
        }
        console.error("Verification resend email failed", email, err);
      }
    }

    return res.status(200).json({ message: GENERIC_MESSAGE });
  } catch (err) {
    console.error("Resend verification error", err);
    return res.status(200).json({ message: GENERIC_MESSAGE });
  }
}
