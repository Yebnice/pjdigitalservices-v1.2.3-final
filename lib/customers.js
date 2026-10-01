import { getSupabase } from "./supabaseClient";
import crypto from "crypto";

// Never include password_hash, verification_token, or reset_token in
// anything handed back to an API response or the browser.
// Verification / reset tokens are stored as SHA-256 hashes, so a leaked
// database row can't be turned into a working reset link. The raw token only
// ever exists in the email we send.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function toPublicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    phone: row.phone,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at,
  };
}

export async function findCustomer(email) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("email", (email || "").toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function listCustomers() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// Real account creation — distinct from upsertCustomer above (which is the
// older "just remember my details for autofill" convenience and must never
// silently overwrite a real account's password). Fails clearly if the
// email or username is already taken, rather than overwriting anything.
export async function registerCustomerAccount({ name, username, email, phone, passwordHash }) {
  const supabase = getSupabase();
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const verificationExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  const verificationSentAt = now.toISOString();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      phone,
      password_hash: passwordHash,
      email_verified: false,
      verification_token: hashToken(verificationToken),
      verification_expires_at: verificationExpiresAt,
      verification_sent_at: verificationSentAt,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      // Postgres unique-violation — tell which field without leaking DB internals.
      if (error.message.includes("username")) throw new Error("That username is already taken");
      // The email is already registered. If that account was never verified, the
      // earlier registrant never proved they own the address — so whoever is
      // registering now (possibly the real owner) takes it over. Otherwise an
      // attacker could pre-register someone's email with a password they know,
      // then wait for the owner to verify it.
      const { data: reclaimed, error: reclaimError } = await supabase
        .from("customers")
        .update({
          name,
          username: username.toLowerCase(),
          phone,
          password_hash: passwordHash,
          verification_token: hashToken(verificationToken),
          verification_expires_at: verificationExpiresAt,
          verification_sent_at: verificationSentAt,
          reset_token: null,
          reset_expires_at: null,
        })
        .eq("email", email.toLowerCase())
        .eq("email_verified", false)
        .select()
        .maybeSingle();
      if (reclaimError) {
        if (reclaimError.code === "23505") throw new Error("That username is already taken");
        throw new Error(reclaimError.message);
      }
      if (reclaimed) return { customer: toPublicCustomer(reclaimed), verificationToken };
      throw new Error("An account with that email already exists");
    }
    throw new Error(error.message);
  }
  return { customer: toPublicCustomer(data), verificationToken };
}

// Generate a fresh verification token only when the previous verification
// email was not sent within the last 10 minutes. The cooldown check is part
// of the database update so two concurrent resend requests cannot both win.
// The public API deliberately returns the same response for unknown,
// already-verified, and cooldown cases to avoid account enumeration.
export async function resendCustomerVerification(email) {
  const supabase = getSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const verificationExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("customers")
    .update({
      verification_token: hashToken(verificationToken),
      verification_expires_at: verificationExpiresAt,
      verification_sent_at: now.toISOString(),
    })
    .eq("email", normalizedEmail)
    .eq("email_verified", false)
    .or(`verification_sent_at.is.null,verification_sent_at.lt.${cutoff}`)
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return { customer: toPublicCustomer(data), verificationToken };
}

// Internal-only — includes password_hash, used solely by the login route's
// own password check. Never return this object from an API route.
export async function revokeCustomerVerificationToken(token) {
  if (!token) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("customers")
    .update({ verification_token: null, verification_expires_at: null, verification_sent_at: null })
    .eq("verification_token", hashToken(token));
  if (error) throw new Error(error.message);
}

export async function findCustomerCredentialsByIdentifier(identifier) {
  const supabase = getSupabase();
  const value = String(identifier || "").trim().toLowerCase();
  // A real email or username never legitimately contains a comma or
  // parenthesis — both have special meaning in PostgREST's .or() filter
  // syntax (comma separates conditions, parentheses group them). Without
  // this check, someone could craft an identifier that alters which row
  // the filter actually matches. This can't bypass the password check
  // that happens afterward, but there's no reason to accept it at all.
  if (!value || value.length > 254 || /[,()]/.test(value)) return null;
  // Look up by exactly one column (no string-built .or() filter): an email
  // always contains "@", a username never can.
  const column = value.includes("@") ? "email" : "username";
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Raw row for session validation only. Never return this from an API route.
export async function findCustomerRowById(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function findCustomerById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return toPublicCustomer(data);
}

export async function verifyCustomerEmail(token) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("customers")
    .update({ email_verified: true, verification_token: null, verification_expires_at: null, verification_sent_at: null })
    .eq("verification_token", hashToken(token))
    .gt("verification_expires_at", new Date().toISOString())
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return toPublicCustomer(data);
}

export async function setPasswordResetToken(email) {
  const supabase = getSupabase();
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  const { data, error } = await supabase
    .from("customers")
    .update({ reset_token: hashToken(resetToken), reset_expires_at: resetExpiresAt })
    .eq("email", (email || "").toLowerCase())
    // Cooldown: if a reset link was issued in the last 2 minutes, don't replace
    // it. Stops anyone invalidating a customer's valid link or mail-bombing them.
    .or(`reset_expires_at.is.null,reset_expires_at.lt.${new Date(Date.now() + 58 * 60 * 1000).toISOString()}`)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null; // no account with that email — caller stays silent either way, see the API route
  return { customer: toPublicCustomer(data), resetToken };
}

export async function resetPasswordWithToken(token, newPasswordHash) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("customers")
    // A reset link only reaches the mailbox owner, so it also proves the email is theirs.
    .update({ password_hash: newPasswordHash, reset_token: null, reset_expires_at: null, email_verified: true, verification_token: null, verification_expires_at: null })
    .eq("reset_token", hashToken(token))
    .gt("reset_expires_at", new Date().toISOString())
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return toPublicCustomer(data);
}

export { toPublicCustomer };
