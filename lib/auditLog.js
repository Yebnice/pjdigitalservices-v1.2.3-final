import { getSupabase } from "./supabaseClient";

// Records one admin-action entry. Deliberately fire-and-forget from the
// caller's perspective (never throws outward) — a failure to WRITE an audit
// entry must never block the actual action (marking an order fulfilled,
// updating a feedback status) from completing. Logging is diagnostic, not
// load-bearing.
export async function recordAuditEvent({ actor = "admin", action, reference = null, note = null }) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("audit_log").insert({ actor, action, reference, note });
    if (error) console.error("Audit log write failed:", error.message);
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}

export async function listAuditLog(limit = 200) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actor: row.actor,
    action: row.action,
    reference: row.reference,
    note: row.note,
  }));
}
