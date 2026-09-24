// A small generic key/value store, backed by the app_settings table
// (supabase/schema.sql / supabase/migration_v1_3_0.sql). This exists for
// background-job state that needs to survive BETWEEN cron runs — the
// in-memory rateLimit() in lib/rateLimit.js can't do that on serverless
// (each cold start resets it), so anything that actually needs to persist
// goes here instead. Currently used only for the Techlink low-balance
// alert cooldown (see checkTechlinkWalletBalance in lib/orderProcessing.js)
// but written generically since more job state will likely need this.
import { getSupabase } from "./supabaseClient";

export async function getAppSetting(key) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.value : null;
}

export async function setAppSetting(key, value) {
  const supabase = getSupabase();
  const { error } = await supabase.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function clearAppSetting(key) {
  const supabase = getSupabase();
  const { error } = await supabase.from("app_settings").delete().eq("key", key);
  if (error) throw new Error(error.message);
}
