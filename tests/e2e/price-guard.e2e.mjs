// End-to-end: the real payAndFulfil() against a fake browser. Run with:
// node --import ./tests/e2e/loader/register.mjs tests/e2e/price-guard.e2e.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { payAndFulfil } = await import(pathToFileURL(ROOT + "lib/payment.js").href);

let confirmAnswer = true, confirmCalls = [], popups = [], abandoned = [], serverAmount = 4.59;
const store = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
globalThis.window = {
  sessionStorage: store(), localStorage: store(),
  confirm: (m) => { confirmCalls.push(m); return confirmAnswer; },
  PaystackPop: class { newTransaction(o) { popups.push(o); } },
};
globalThis.fetch = async (url, opts = {}) => {
  const json = (b) => ({ ok: true, status: 200, json: async () => b });
  if (String(url).endsWith("/api/orders/create")) return json({ reference: "REF1", amount: serverAmount });
  if (String(url).endsWith("/api/orders/abandon")) { abandoned.push(JSON.parse(opts.body).reference); return json({}); }
  return json({});
};
const out = [];
const t = async (name, fn) => {
  confirmAnswer = true; confirmCalls = []; popups = []; abandoned = []; serverAmount = 4.59;
  try { await fn(); out.push("PASS " + name); } catch (e) { out.push("FAIL " + name + " -> " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); }
  // Close any popup the test left open (customer taps X) so the app's real
  // one-checkout-at-a-time lock is released before the next test.
  for (const p of popups) p.onCancel?.();
};
const pay = (extra = {}) => new Promise((resolve) => {
  payAndFulfil({ orderType: "tierData", phone: "0241234567", email: "a@b.co", ...extra, onDone: () => resolve({ ok: true }), onError: (message) => resolve({ ok: false, message }) });
  setTimeout(() => resolve({ pending: true }), 50); // popup opened and is waiting for the customer
});

await t("same price: no question asked, popup opens at the server's amount", async () => {
  const r = await pay({ expectedAmount: 4.59 });
  assert.equal(confirmCalls.length, 0); assert.equal(popups.length, 1); assert.equal(popups[0].amount, 459); assert.ok(r.pending);
});
await t("price differs and customer DECLINES: no popup, order abandoned, clear message", async () => {
  confirmAnswer = false;
  const r = await pay({ expectedAmount: 4.58 });
  assert.equal(confirmCalls.length, 1); assert.equal(popups.length, 0);
  assert.deepEqual(abandoned, ["REF1"]); assert.equal(r.ok, false); assert.ok(/4\.58/.test(r.message) && /4\.59/.test(r.message), r.message);
});
await t("price differs and customer ACCEPTS: popup opens at the new server amount", async () => {
  const r = await pay({ expectedAmount: 4.58 });
  assert.equal(confirmCalls.length, 1); assert.equal(popups.length, 1); assert.equal(popups[0].amount, 459); assert.equal(abandoned.length, 0);
});
await t("no expectedAmount (old callers): behaves exactly as before", async () => {
  await pay({}); assert.equal(confirmCalls.length, 0); assert.equal(popups.length, 1);
});
await t("a declined checkout does not leave the tab locked: the next attempt works", async () => {
  confirmAnswer = false; await pay({ expectedAmount: 4.58 });
  confirmAnswer = true; await pay({ expectedAmount: 4.59 });
  assert.equal(popups.length, 1);
});
await t("bulk tolerance: a 2-pesewa drift across many lines is not questioned", async () => {
  serverAmount = 100.02;
  await pay({ expectedAmount: 100.0, expectedTolerance: 0.01 + 0.005 * 10 });
  assert.equal(confirmCalls.length, 0); assert.equal(popups.length, 1);
});
console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
