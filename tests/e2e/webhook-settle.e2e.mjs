// End-to-end: Paystack notifications are settled at once when fresh and genuine, and NEVER delivered by a background run when stale or unpaid.
// (header of delivery-safety reused)  An order may only reach Techlink when (a) Paystack confirms REAL LIVE money, (b) it is fresh, and (c) delivery mode allows it, or (d) a named admin approves it.
// Run with: node --import ./tests/e2e/loader/register.mjs tests/e2e/webhook-settle.e2e.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const load = (rel) => import(pathToFileURL(ROOT + rel).href);
import assert from "node:assert"; import crypto from "node:crypto";
// Built at runtime so the repository secret scanner does not mistake these placeholders for real keys.
const FAKE_LIVE = ["sk", "live", "placeholder"].join("_");
const FAKE_TEST = ["sk", "test", "placeholder"].join("_");
process.env.RESEND_API_KEY = "re_test"; process.env.NOTIFICATION_FROM_EMAIL = "PjDigital <noreply@pjdigitalservices.online>"; process.env.NODE_ENV = "test";
process.env.PAYSTACK_SECRET_KEY = FAKE_TEST; process.env.TECHLINK_API_KEY = "tlg_test_x";
process.env.ADMIN_SESSION_SECRET = "s".repeat(48); process.env.CRON_SECRET = "cron-secret-value-0123456789abcdef";
const hash = (pw) => { const salt = "ab12"; return `${salt}$${crypto.scryptSync(pw, salt, 32).toString("hex")}`; };
process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: "op", role: "operator", passwordHash: hash("x") }, { username: "ad", role: "admin", passwordHash: hash("x") }, { username: "vw", role: "viewer", passwordHash: hash("x") }]);

const memdb = await import("./loader/memdb.mjs");
const auth = await load("lib/adminAuth.js");
const { runWorkerCycle } = await load("lib/workerRun.js");
const store = await load("lib/store.js");

// ---- fake outside world ----
const world = { emails: [], paystack: {}, techlinkOrders: [], techlinkCalls: [], paystackCalls: [], paystackDown: false, walletBalance: 500 };
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  if (url.includes("api.paystack.co/transaction/verify/")) {
    const ref = decodeURIComponent(url.split("/verify/")[1]); world.paystackCalls.push(ref);
    if (world.paystackDown) return json(503, { status: false, message: "paystack down" });
    const t = world.paystack[ref]; if (!t) return json(404, { status: false, message: "Transaction reference not found" });
    return json(200, { status: true, data: { reference: ref, ...t } });
  }
  if (url.includes("api.resend.com/emails")) { world.emails.push(JSON.parse(opts.body)); return json(200, { id: "em_1" }); }
  if (url.includes("/wallet/balance")) return json(200, { success: true, balance: world.walletBalance });
  if (url.includes("/products/airtime-fee")) return json(200, { percent: 2, rate: 0.02 });
  if (url.includes("/airtime") && opts.method === "POST") { const body = JSON.parse(opts.body); world.techlinkCalls.push({ path: "/airtime", body }); return json(201, { success: true, message: "airtime ok", orderId: "ORD-NEW" + world.techlinkCalls.length, newBalance: 400 }); }
  if (/\/orders\?page=/.test(url)) return json(200, { rows: world.techlinkOrders });
  return json(404, { message: "fake: unhandled " + url });
};

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
let n = 0;
const seed = (over = {}) => { const ref = over.reference || `REF${++n}`; const row = { reference: ref, order_type: "airtime", network: "mtn", phone: "0241234567", email: "c@d.co", amount: 2, provider_cost: 2.04, checkout_amount: 2.06, paystack_fee_amount: 0.04, customer_product_amount: 2, business_markup_amount: 0, status: "pending", fulfilled: false, fulfillment_status: "pending", fulfillment_attempts: 0, created_at: minsAgo(30), ...over }; memdb.db.tables.orders.push(row); return row; };
const get = (ref) => memdb.db.tables.orders.find((o) => o.reference === ref);
const audit = (action) => memdb.db.tables.audit_log.filter((a) => a.action === action);
const cookieFor = (u, role) => { let c; auth.createAdminSession({ setHeader: (k, v) => { c = v; } }, { username: u, role }); return c.split(";")[0]; };
const mkRes = () => ({ code: null, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; return this; } });
const call = async (mod, user, role, { method = "GET", query = {}, body } = {}) => { const h = (await load(mod)).default; const res = mkRes(); await h({ method, query, body, headers: { cookie: user ? cookieFor(user, role) : "", host: "pjdigitalservices.online" } }, res); return res; };
const fresh = () => { memdb.reset(); world.paystack = {}; world.techlinkOrders = []; world.techlinkCalls = []; world.paystackCalls = []; world.paystackDown = false; world.walletBalance = 500; world.emails = []; };

const out = []; const t = async (name, fn) => { fresh(); try { await fn(); out.push("PASS " + name); } catch (e) { out.push("FAIL " + name + " -> " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); } };
const quiet = console.error; console.error = () => {}; console.warn = () => {};

const delivered = (over = {}) => ({ orderId: "ORD-TL1", productType: "Airtime", phoneNumber: "0241234567", amount: 2.04, costPrice: 2, status: "completed", createdAt: minsAgo(20), ...over });
const manual = (user, role, body) => call("pages/api/orders/manual-review.js", user, role, { method: "POST", body });
const { getDeliveryMode, setDeliveryMode } = await load("lib/deliveryMode.js");
const { verifyAndFulfillOrder, approveAndDeliver, fulfillClaimedOrder } = await load("lib/orderProcessing.js");
const ENV0 = { NODE_ENV: process.env.NODE_ENV, K: process.env.PAYSTACK_SECRET_KEY, TK: process.env.TECHLINK_API_KEY, V: process.env.VERCEL_ENV };
const FAKE_TL_LIVE = ["tlg", "live", "placeholder"].join("_");
const asProduction = () => { process.env.NODE_ENV = "production"; process.env.PAYSTACK_SECRET_KEY = FAKE_LIVE; process.env.TECHLINK_API_KEY = FAKE_TL_LIVE; delete process.env.VERCEL_ENV; };
const asTest = () => { process.env.NODE_ENV = ENV0.NODE_ENV; process.env.PAYSTACK_SECRET_KEY = ENV0.K; process.env.TECHLINK_API_KEY = ENV0.TK; if (ENV0.V === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = ENV0.V; };
const live = (over = {}) => ({ status: "success", amount: 206, currency: "GHS", domain: "live", id: 987654321, fees: 4, ...over });
const afterEachReset = () => { asTest(); };
const tt = async (name, fn) => { await t(name, async () => { try { await fn(); } finally { afterEachReset(); } }); };


const sign = (raw) => crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
const postWebhook = async (ref) => {
  const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, status: "success" } }); const { EventEmitter } = await import("node:events");
  const req = new EventEmitter(); req.method = "POST"; req.headers = { "x-paystack-signature": sign(raw) };
  const res = mkRes(); const h = (await load("pages/api/paystack/webhook.js")).default;
  const p = h(req, res); setImmediate(() => { req.emit("data", Buffer.from(raw)); req.emit("end"); }); await p; return res;
};
const queueRows = () => memdb.db.tables.paystack_webhook_events;

await tt("INSTANT: a fresh, live-verified payment is delivered INSIDE the webhook request, with no worker run", async () => {
  asProduction(); seed({ reference: "FAST1", created_at: minsAgo(3) }); world.paystack.FAST1 = live();
  const res = await postWebhook("FAST1");
  assert.equal(res.code, 200); assert.equal(res.body.settled, true);
  assert.equal(get("FAST1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1);
  assert.equal(queueRows()[0].status, "completed");
});

await tt("INSTANT: a duplicate notification for the same payment never delivers twice", async () => {
  asProduction(); seed({ reference: "DUP", created_at: minsAgo(3) }); world.paystack.DUP = live();
  await postWebhook("DUP"); await postWebhook("DUP"); await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(world.techlinkCalls.length, 1);
});

await tt("UNPAID: a notification whose payment Paystack reports as ABANDONED delivers nothing and closes the checkout", async () => {
  asProduction(); seed({ reference: "ABAN1", created_at: minsAgo(3) }); world.paystack.ABAN1 = { status: "abandoned", amount: 206, currency: "GHS", domain: "live" };
  const res = await postWebhook("ABAN1"); await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(res.code, 200); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("ABAN1").fulfilled, false); assert.equal(get("ABAN1").fail_reason, "payment_abandoned");
});

await tt("UNPAID: a notification for a reference Paystack has no record of delivers nothing", async () => {
  asProduction(); seed({ reference: "GHOST1", created_at: minsAgo(3) });
  await postWebhook("GHOST1"); await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(world.techlinkCalls.length, 0); assert.equal(get("GHOST1").fulfilled, false);
});

await tt("UNPAID: a test-mode 'success' arriving by webhook on the live site delivers nothing", async () => {
  asProduction(); seed({ reference: "TST1", created_at: minsAgo(3) }); world.paystack.TST1 = live({ domain: "test" });
  await postWebhook("TST1"); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("TST1").fulfilled, false);
});

await tt("WRONG AMOUNT: a payment smaller than the order total is not delivered, and is flagged for the admin", async () => {
  asProduction(); seed({ reference: "SHORT1", created_at: minsAgo(3) }); world.paystack.SHORT1 = live({ amount: 100 });
  await postWebhook("SHORT1"); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("SHORT1").fail_reason, "amount_mismatch");
});

await tt("STALE: a notification that waited hours is NEVER delivered by the worker, even for a young checkout; it is held for the admin", async () => {
  asProduction(); seed({ reference: "STALE1", created_at: minsAgo(5) }); world.paystack.STALE1 = live();
  queueRows().push({ id: 901, event_key: "k901", event_type: "charge.success", reference: "STALE1", payload: {}, status: "pending", attempts: 0, available_at: minsAgo(1), received_at: minsAgo(180) });
  const r = await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(world.techlinkCalls.length, 0); assert.equal(get("STALE1").fulfilled, false);
  assert.equal(get("STALE1").fulfillment_status, "manual_review"); assert.equal(get("STALE1").payment_amount, 206);
});

await tt("STALE: the admin can then approve that held payment, and only then does it reach Techlink", async () => {
  asProduction(); seed({ reference: "STALE2", created_at: minsAgo(5) }); world.paystack.STALE2 = live();
  queueRows().push({ id: 902, event_key: "k902", event_type: "charge.success", reference: "STALE2", payload: {}, status: "pending", attempts: 0, available_at: minsAgo(1), received_at: minsAgo(180) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(world.techlinkCalls.length, 0);
  const r = await approveAndDeliver("STALE2", { approvedBy: "ad" });
  assert.equal(get("STALE2").fulfilled, true); assert.equal(world.techlinkCalls.length, 1);
});

await tt("BACKSTOP: with instant settling switched off the notification is queued, and a fresh one is still delivered by the next worker run", async () => {
  asProduction(); process.env.WEBHOOK_INLINE_SETTLE = "false";
  try {
    seed({ reference: "BACK1", created_at: minsAgo(3) }); world.paystack.BACK1 = live();
    const res = await postWebhook("BACK1"); assert.equal(res.body.settled, false); assert.equal(world.techlinkCalls.length, 0); assert.equal(queueRows()[0].status, "pending");
    await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(get("BACK1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1);
  } finally { delete process.env.WEBHOOK_INLINE_SETTLE; }
});

await tt("BACKSTOP: if Paystack is down during the webhook, the payment is kept for retry (200 to Paystack, nothing lost, nothing delivered)", async () => {
  asProduction(); seed({ reference: "DOWN1", created_at: minsAgo(3) }); world.paystack.DOWN1 = live(); world.paystackDown = true;
  const res = await postWebhook("DOWN1"); assert.equal(res.code, 200); assert.equal(world.techlinkCalls.length, 0);
  assert.equal(queueRows()[0].status, "pending"); assert.ok(queueRows()[0].last_error);
  world.paystackDown = false; queueRows()[0].available_at = minsAgo(1);
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(get("DOWN1").fulfilled, true);
});

await tt("AUDIT: every delivery leaves Paystack's evidence AND who sent it; an unpaid order leaves no 'sent to Techlink' record", async () => {
  asProduction(); seed({ reference: "AUD1", created_at: minsAgo(3) }); seed({ reference: "AUD2", created_at: minsAgo(3) });
  world.paystack.AUD1 = live(); world.paystack.AUD2 = { status: "abandoned", amount: 206, currency: "GHS", domain: "live" };
  await postWebhook("AUD1"); await postWebhook("AUD2");
  const forRef = (a, ref) => audit(a).filter((x) => x.reference === ref);
  assert.equal(forRef("paystack_payment_confirmed", "AUD1").length, 1); assert.match(forRef("paystack_payment_confirmed", "AUD1")[0].note, /paystack_txn_id=987654321/);
  assert.equal(forRef("sent_to_techlink", "AUD1").length, 1); assert.match(forRef("sent_to_techlink", "AUD1")[0].note, /automatic/);
  assert.equal(forRef("sent_to_techlink", "AUD2").length, 0); assert.equal(forRef("paystack_payment_confirmed", "AUD2").length, 0);
});

await tt("GATE: an order that is already finished can never be pulled back into the delivery path by a payment confirmation", async () => {
  seed({ reference: "FIN1", status: "success", fulfilled: false, fulfillment_status: "ready" });
  const r = await store.markPaymentVerified("FIN1", 206, null);
  assert.equal(get("FIN1").status, "success"); assert.notEqual(get("FIN1").status, "payment_verified");
});

await tt("TABLE: the admin's Paystack notifications table lists waiting notifications with their order, and is read-only", async () => {
  seed({ reference: "TAB1", created_at: minsAgo(5), order_no: "PJ-TAB00001" });
  queueRows().push({ id: 910, event_key: "k910", event_type: "charge.success", reference: "TAB1", payload: {}, status: "pending", attempts: 0, available_at: minsAgo(1), received_at: minsAgo(180) });
  queueRows().push({ id: 911, event_key: "k911", event_type: "charge.success", reference: "TAB1", payload: {}, status: "completed", attempts: 1, available_at: minsAgo(1), received_at: minsAgo(500) });
  const r = await call("pages/api/admin/webhook-notifications.js", "op", "operator");
  assert.equal(r.code, 200); assert.equal(r.body.notifications.length, 1);
  assert.equal(r.body.notifications[0].orderNo, "PJ-TAB00001"); assert.ok(r.body.notifications[0].waitingMinutes >= 179);
  const viewer = await call("pages/api/admin/webhook-notifications.js", "vw", "viewer"); assert.equal(viewer.code, 403);
  const anon = await call("pages/api/admin/webhook-notifications.js", null, null); assert.equal(anon.code, 401);
  const post = await call("pages/api/admin/webhook-notifications.js", "op", "operator", { method: "POST" }); assert.equal(post.code, 405);
  assert.equal(world.techlinkCalls.length, 0);
});

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
