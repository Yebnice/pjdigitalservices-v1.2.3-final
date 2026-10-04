// Browser-side helpers for the admin dashboard. The pure functions here
// (formatting, status labels) are unit-tested; adminApi is the one place that
// talks to the admin endpoints, so session expiry and errors are handled the
// same way everywhere instead of each button doing its own thing.
import { isAbandonedOrder } from "./orderStatus";

export async function adminApi(url, { method = "GET", body, onUnauthorized } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw Object.assign(new Error("Could not reach the server. Check your connection."), { status: 0 });
  }
  if (res.status === 401) {
    onUnauthorized?.();
    throw Object.assign(new Error("Your admin session has ended. Please sign in again."), { status: 401 });
  }
  let data = {};
  const raw = await res.text();
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (HTTP ${res.status})`), { status: res.status, data });
  return data;
}

export function ghs(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `GHS ${safe.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "12 min", "3 h", "2 d" — how long ago something happened.
export function ageText(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return "—";
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function minutesToText(minutes) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

// One plain-language status per order, from the fields the dashboard has.
export function orderStatusBadge(order) {
  if (!order) return { text: "Unknown", tone: "muted" };
  const fs = order.fulfillmentStatus;
  if (order.status === "success" || fs === "fulfilled") return { text: "Delivered", tone: "green" };
  if (order.status === "payment_rejected_after_charge") return { text: "Paid — under review", tone: "amber" };
  if (["payment_failed", "failed"].includes(order.status)) {
    return isAbandonedOrder(order) ? { text: "Abandoned", tone: "muted" } : { text: "Payment failed", tone: "red" };
  }
  if (fs === "resolved") return { text: "Resolved by admin", tone: "muted" };
  if (fs === "manual_review" && order.failReason === "held_for_approval") return { text: "Paid — awaiting your approval", tone: "amber" };
  if (fs === "manual_review") return { text: "Needs review", tone: "red" };
  if (fs === "failed") return { text: "Delivery failed", tone: "red" };
  if (fs === "queued_with_provider") return { text: "Queued with provider", tone: "amber" };
  if (fs === "processing") return { text: "Processing", tone: "amber" };
  if (order.status === "payment_verified") return { text: "Paid — sending", tone: "amber" };
  if (["pending", "payment_pending"].includes(order.status)) return { text: "Awaiting payment", tone: "muted" };
  return { text: String(order.status || "Unknown"), tone: "muted" };
}

export const TONE_COLORS = { green: "var(--green, #16a34a)", red: "#dc2626", amber: "#b45309", muted: "var(--muted-dim, #6b7280)" };

// Our own order number if the order has one, otherwise the reference (orders
// created before the order-number migration was run).
export function orderNoOf(order) {
  return order?.orderNo || order?.reference || "—";
}

// "5 Oct 2026, 10:16 pm"
export function whenText(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
