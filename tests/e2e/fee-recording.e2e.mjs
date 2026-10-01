// End-to-end: Paystack's real fee is recorded per order and unexpected fees are flagged.
// Run with: node --import ./tests/e2e/loader/register.mjs tests/e2e/fee-recording.e2e.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const load = (rel) => import(pathToFileURL(ROOT + rel).href);
process.env.PAYSTACK_SECRET_KEY = "sk_test_x"; process.env.TECHLINK_API_KEY = "tlg_test_x"; process.env.NODE_ENV = "test";

const memdb = await import("./loader/memdb.mjs");
const { verifyAndPrepareOrder } = await load("lib/orderProcessing.js");

const world = { paystack: {} };
globalThis.fetch = async (url) => {
  url = String(url);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  if (url.includes("api.paystack.co/transaction/verify/")) {
    const ref = decodeURIComponent(url.split("/verify/")[1]);
    const t = world.paystack[ref];
    return t ? json(200, { status: true, data: { reference: ref, ...t } }) : json(404, { status: false, message: "not found" });
  }
  return json(404, { message: "fake: unhandled " + url });
};
console.error = () => {}; console.warn = () => {};

// A GHS 4.49 product: customer is charged 4.59, expected fee 0.10.
const seed = (ref) => memdb.db.tables.orders.push({
  reference: ref, order_type: "tierData", network: "mtn", phone: "0241234567", email: "c@d.co",
  amount: 4.4, provider_cost: 4.4, checkout_amount: 4.59, paystack_fee_amount: 0.1,
  customer_product_amount: 4.49, business_markup_amount: 0.09,
  status: "pending", fulfilled: false, fulfillment_status: "pending", fulfillment_attempts: 0,
});
const get = (ref) => memdb.db.tables.orders.find((o) => o.reference === ref);
const audit = (action) => memdb.db.tables.audit_log.filter((a) => a.action === action);
const out = [];
const t = async (name, fn) => { memdb.reset(); world.paystack = {}; memdb.db.missingColumns = null; try { await fn(); out.push("PASS " + name); } catch (e) { out.push("FAIL " + name + " -> " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); } };

await t("the real Paystack fee and net settlement are stored on the order", async () => {
  seed("F1"); world.paystack.F1 = { status: "success", amount: 459, currency: "GHS", fees: 9 };
  const r = await verifyAndPrepareOrder("F1");
  assert.equal(r.kind, "ready");
  assert.equal(get("F1").paystack_fee_actual, 0.09); assert.equal(get("F1").paystack_net_settled, 4.5);
  assert.equal(audit("paystack_net_below_price").length + audit("paystack_fee_differs").length, 0);
});

await t("an order that settles BELOW the product price is flagged, but is still delivered normally", async () => {
  seed("F2"); world.paystack.F2 = { status: "success", amount: 459, currency: "GHS", fees: 14 };
  const r = await verifyAndPrepareOrder("F2");
  assert.equal(r.kind, "ready", "bookkeeping must never block fulfilment");
  assert.equal(audit("paystack_net_below_price").length, 1);
  assert.equal(audit("paystack_net_below_price")[0].reference, "F2");
});

await t("verifying the same order twice does not raise the alert twice", async () => {
  seed("F3"); world.paystack.F3 = { status: "success", amount: 459, currency: "GHS", fees: 14 };
  await verifyAndPrepareOrder("F3"); await verifyAndPrepareOrder("F3");
  assert.equal(audit("paystack_net_below_price").length, 1);
});

await t("a response with no fee figure still verifies and records nothing", async () => {
  seed("F4"); world.paystack.F4 = { status: "success", amount: 459, currency: "GHS" };
  const r = await verifyAndPrepareOrder("F4");
  assert.equal(r.kind, "ready"); assert.equal(get("F4").paystack_fee_actual, undefined);
});

await t("if migration_v1_3_7.sql has not been run, a paid order is still verified", async () => {
  memdb.db.missingColumns = new Set(["paystack_fee_actual", "paystack_net_settled"]);
  seed("F5"); world.paystack.F5 = { status: "success", amount: 459, currency: "GHS", fees: 9 };
  const r = await verifyAndPrepareOrder("F5");
  assert.equal(r.kind, "ready"); assert.equal(get("F5").status, "payment_verified");
});

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
