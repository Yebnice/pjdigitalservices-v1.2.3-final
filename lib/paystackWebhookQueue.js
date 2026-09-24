import crypto from "crypto";
import { getSupabase } from "./supabaseClient";

const MAX_QUEUE_ATTEMPTS = Math.max(1, Number(process.env.PAYSTACK_WEBHOOK_MAX_ATTEMPTS || 5));
const STALE_PROCESSING_MINUTES = Math.max(1, Number(process.env.PAYSTACK_WEBHOOK_STALE_MINUTES || 10));

function eventKey(rawBody) {
  return crypto.createHash("sha256").update(String(rawBody || "")).digest("hex");
}

export async function enqueuePaystackWebhook({ event, rawBody }) {
  const reference = String(event?.data?.reference || "").trim();
  if (event?.event !== "charge.success" || !reference) return null;

  const supabase = getSupabase();
  const key = eventKey(rawBody);
  const row = {
    event_key: key,
    event_type: event.event,
    reference,
    payload: event,
    status: "pending",
    available_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("paystack_webhook_events")
    .insert(row)
    .select("id, reference, status")
    .maybeSingle();

  if (!error && data) return data;

  // Paystack may legitimately retry the same webhook. A unique event key or
  // reference means that retry should be acknowledged, not create another job.
  if (error?.code === "23505") {
    const { data: existing, error: lookupError } = await supabase
      .from("paystack_webhook_events")
      .select("id, reference, status")
      .eq("event_type", event.event)
      .eq("reference", reference)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing?.status === "failed") {
      const { data: requeued, error: requeueError } = await supabase
        .from("paystack_webhook_events")
        .update({
          status: "pending",
          attempts: 0,
          available_at: new Date().toISOString(),
          locked_at: null,
          processed_at: null,
          last_error: null,
        })
        .eq("id", existing.id)
        .select("id, reference, status")
        .single();
      if (requeueError) throw new Error(requeueError.message);
      return requeued;
    }
    return existing;
  }

  throw new Error(error?.message || "Could not enqueue Paystack webhook");
}

async function releaseStaleClaims(supabase) {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { error } = await supabase
    .from("paystack_webhook_events")
    .update({
      status: "pending",
      locked_at: null,
      available_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("locked_at", cutoff);

  if (error) throw new Error(error.message);
}

export async function claimPaystackWebhookJobs(limit = 10) {
  const supabase = getSupabase();
  await releaseStaleClaims(supabase);

  const { data: candidates, error } = await supabase
    .from("paystack_webhook_events")
    .select("id")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("received_at", { ascending: true })
    .limit(Math.max(1, limit));

  if (error) throw new Error(error.message);

  const claimed = [];
  for (const candidate of candidates || []) {
    const { data, error: claimError } = await supabase
      .from("paystack_webhook_events")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (claimError) throw new Error(claimError.message);
    if (!data) continue;

    // Increment separately after the atomic status claim so two workers cannot
    // both process the same event.
    const { data: incremented, error: incrementError } = await supabase
      .from("paystack_webhook_events")
      .update({ attempts: Number(data.attempts || 0) + 1 })
      .eq("id", data.id)
      .eq("status", "processing")
      .select("*")
      .single();

    if (incrementError) throw new Error(incrementError.message);
    claimed.push(incremented);
  }

  return claimed;
}

export async function completePaystackWebhookJob(id) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("paystack_webhook_events")
    .update({
      status: "completed",
      locked_at: null,
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw new Error(error.message);
}

export async function failPaystackWebhookJob(id, errorMessage) {
  const supabase = getSupabase();
  const { data: current, error: readError } = await supabase
    .from("paystack_webhook_events")
    .select("attempts")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const attempts = Number(current?.attempts || 0);
  // Do not permanently dead-letter payment verification because a transient
  // Paystack/Supabase outage happened to last longer than a few attempts.
  // After the configured threshold, keep retrying at the maximum backoff.
  const delayMinutes = attempts >= MAX_QUEUE_ATTEMPTS
    ? 30
    : Math.min(30, Math.max(1, 2 ** Math.min(attempts - 1, 5)));

  const { error } = await supabase
    .from("paystack_webhook_events")
    .update({
      status: "pending",
      locked_at: null,
      available_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      last_error: String(errorMessage || "Webhook job failed").slice(0, 2000),
    })
    .eq("id", id)
    .eq("status", "processing");

  if (error) throw new Error(error.message);
  return { terminal: false };
}

export async function processPaystackWebhookQueue(limit = 10) {
  const jobs = await claimPaystackWebhookJobs(limit);
  const results = [];

  for (const job of jobs) {
    try {
      const { verifyAndPrepareOrder } = await import("./orderProcessing");
      const result = await verifyAndPrepareOrder(job.reference);
      if (result?.kind === "payment_pending") {
        const failure = await failPaystackWebhookJob(job.id, `Paystack still reports payment status: ${result.status || "pending"}`);
        results.push({
          id: job.id,
          reference: job.reference,
          status: failure.terminal ? "failed" : "retrying",
          orderResult: result.kind,
        });
        continue;
      }
      await completePaystackWebhookJob(job.id);
      results.push({
        id: job.id,
        reference: job.reference,
        status: "completed",
        orderResult: result?.kind || null,
      });
    } catch (err) {
      const failure = await failPaystackWebhookJob(job.id, err.message);
      results.push({
        id: job.id,
        reference: job.reference,
        status: failure.terminal ? "failed" : "retrying",
        error: err.message,
      });
    }
  }

  return results;
}
