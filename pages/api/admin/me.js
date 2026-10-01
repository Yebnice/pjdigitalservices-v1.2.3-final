import { adminMode, adminSessionActor, totpSecretFor, twoFactorRequired } from "../../../lib/adminAuth";
import { permissionsFor } from "../../../lib/adminPermissions";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const actor = adminSessionActor(req);
  return res.status(200).json({
    authenticated: Boolean(actor),
    role: actor?.role || null,
    username: actor?.username || null,
    // "shared" = everyone signs in with one password, so the audit log cannot tell staff apart.
    mode: actor ? adminMode() : null,
    twoFactor: Boolean(actor?.mfa),
    twoFactorAvailable: actor ? Boolean(totpSecretFor(actor)) : false,
    twoFactorRequired: twoFactorRequired(),
    // The dashboard uses this only to hide buttons; the server re-checks every action.
    permissions: actor ? permissionsFor(actor.role) : [],
  });
}
