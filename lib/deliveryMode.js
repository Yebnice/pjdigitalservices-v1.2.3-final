// The admin's safety switch: "automatic" (fresh, live-verified payments are sent
// to Techlink straight away) or "manual" (every paid order waits in Needs
// attention until an admin approves it). Stored in app_settings so it survives
// restarts and applies to every serverless instance immediately.
//
// Fails CLOSED: if the setting cannot be read, behave as "manual". Wrongly
// holding an order costs a short delay; wrongly delivering one costs money.
import { getAppSetting, setAppSetting } from "./appSettings";
import { normaliseDeliveryMode } from "./deliveryPolicy";

export const DELIVERY_MODE_KEY = "delivery_mode";

// { mode, known }. `known: false` means the setting could not be read right now.
// Callers must treat that as "do nothing yet" (leave the order exactly as it is
// and try again), NOT as a reason to park the order for manual approval: a
// one-second database blip must not turn paid orders into manual work.
export async function getDeliveryModeStatus(env = process.env) {
  try {
    const stored = await getAppSetting(DELIVERY_MODE_KEY);
    const fromDb = normaliseDeliveryMode(stored?.mode ?? stored);
    if (fromDb) return { mode: fromDb, known: true };
  } catch (err) {
    console.error("Could not read delivery mode, nothing will be delivered until it can:", err?.message);
    return { mode: "manual", known: false };
  }
  return { mode: normaliseDeliveryMode(env.DELIVERY_MODE) || "automatic", known: true };
}

// Convenience for display: an unreadable setting shows as "manual" (the cautious view).
export async function getDeliveryMode(env = process.env) {
  return (await getDeliveryModeStatus(env)).mode;
}

export async function setDeliveryMode(mode, actor) {
  const clean = normaliseDeliveryMode(mode);
  if (!clean) throw new Error('Delivery mode must be "automatic" or "manual"');
  await setAppSetting(DELIVERY_MODE_KEY, { mode: clean, changedBy: actor || null, changedAt: new Date().toISOString() });
  return clean;
}
