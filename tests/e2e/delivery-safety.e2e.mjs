// End-to-end: the delivery-safety rules. An order may only reach Techlink when (a) Paystack confirms REAL LIVE money, (b) it is fresh, and (c) delivery mode allows it, or (d) a named admin approves it.
// Run with: node --import ./tests/e2e/loader/register.mjs tests/e2e/delivery-safety.e2e.mjs
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

// ---------------------------------------------------------------- the incident
await tt("INCIDENT: an UNPAID checkout (Paystack: abandoned / not found) is never sent to Techlink, however many times the worker runs", async () => {
  seed({ reference: "UNPAID1", created_at: minsAgo(15) }); seed({ reference: "UNPAID2", created_at: minsAgo(500) });
  world.paystack.UNPAID1 = { status: "abandoned", amount: 206, currency: "GHS" }; // UNPAID2: Paystack has no record at all
  for (let i = 0; i < 3; i += 1) await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(world.techlinkCalls.length, 0); assert.equal(get("UNPAID1").fulfilled, false); assert.equal(get("UNPAID2").fulfilled, false);
});

await tt("INCIDENT ROOT CAUSE: a TEST-mode 'success' on the production site is blocked (no money moved) and audited, never delivered", async () => {
  asProduction();
  seed({ reference: "TEST1", created_at: minsAgo(5) }); world.paystack.TEST1 = live({ domain: "test" });
  const r = await verifyAndFulfillOrder("TEST1");
  assert.equal(r.kind, "failed"); assert.equal(r.status, "test_mode_payment");
  assert.equal(world.techlinkCalls.length, 0); assert.equal(get("TEST1").fulfilled, false); assert.equal(get("TEST1").fail_reason, "test_mode_payment");
  assert.equal(audit("payment_blocked_test_mode_payment").length, 1);
});

await tt("INCIDENT ROOT CAUSE: a TEST secret key running in production blocks EVERY delivery, even for a response labelled live", async () => {
  asProduction(); process.env.PAYSTACK_SECRET_KEY = FAKE_TEST;
  seed({ reference: "TK1", created_at: minsAgo(5) }); world.paystack.TK1 = live();
  const r = await verifyAndFulfillOrder("TK1"); assert.equal(r.status, "test_key_in_production"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("a Paystack response for a DIFFERENT reference is never accepted", async () => {
  asProduction(); seed({ reference: "REFX", created_at: minsAgo(5) }); world.paystack.REFX = live({ reference: "SOMETHING-ELSE" });
  const r = await verifyAndFulfillOrder("REFX"); assert.equal(r.status, "reference_mismatch"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("a real LIVE payment in production still works: fresh order is delivered immediately (customer experience unchanged)", async () => {
  asProduction(); seed({ reference: "LIVE1", created_at: minsAgo(3) }); world.paystack.LIVE1 = live();
  const r = await verifyAndFulfillOrder("LIVE1");
  assert.equal(r.kind === "fulfilled" || r.kind === "success" || get("LIVE1").fulfilled, true, JSON.stringify(r).slice(0, 200));
  assert.equal(world.techlinkCalls.length, 1);
  assert.equal(get("LIVE1").paystack_transaction_id, "987654321"); assert.equal(get("LIVE1").paystack_fee_actual, 0.04);
});

// ---------------------------------------------------------------- the three locks
await tt("LOCK 1 (outstanding check): a paid order it finds is HELD, deliveries is 0, Techlink untouched", async () => {
  seed({ reference: "OLD1", created_at: minsAgo(400) }); world.paystack.OLD1 = live();
  const r = await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(r.sweep.paidHeld, 1); assert.equal(r.sweep.deliveries, 0); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("OLD1").fulfillment_status, "manual_review");
});

await tt("LOCK 2 (age): a webhook-style verify of an OLD checkout is held, not delivered, even though Paystack confirms it", async () => {
  seed({ reference: "OLD2", created_at: minsAgo(300) }); world.paystack.OLD2 = live();
  const r = await verifyAndFulfillOrder("OLD2");
  assert.equal(r.kind, "held"); assert.equal(r.reason, "too_old"); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("OLD2").payment_amount, 206);
});

await tt("LOCK 3 (manual mode): the admin switch holds even a brand-new, genuine payment", async () => {
  await setDeliveryMode("manual", "ad");
  seed({ reference: "MAN1", created_at: minsAgo(1) }); world.paystack.MAN1 = live();
  const r = await verifyAndFulfillOrder("MAN1"); assert.equal(r.kind, "held"); assert.equal(r.reason, "manual_mode"); assert.equal(world.techlinkCalls.length, 0);
  await setDeliveryMode("automatic", "ad");
  seed({ reference: "MAN2", created_at: minsAgo(1) }); world.paystack.MAN2 = live(); await verifyAndFulfillOrder("MAN2"); assert.equal(world.techlinkCalls.length, 1);
});

await tt("LAST MILE: a stray database write that marks an UNPAID order 'ready' still cannot reach Techlink (the worker holds it)", async () => {
  // Exactly what would happen if someone, or something, flipped the row directly.
  seed({ reference: "STRAY1", status: "payment_verified", fulfillment_status: "ready", created_at: minsAgo(2) }); // no payment_verified_at, no payment_amount
  const r = await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(world.techlinkCalls.length, 0, "no payment record = no delivery"); assert.equal(get("STRAY1").fulfilled, false); assert.equal(get("STRAY1").fulfillment_status, "manual_review");
  assert.equal(audit("delivery_blocked_by_policy").length, 1);
});

await tt("LAST MILE: an order verified for LESS than its total is not delivered by the worker", async () => {
  seed({ reference: "SHORT1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(2), payment_amount: 100, created_at: minsAgo(3) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("SHORT1").fulfillment_status, "manual_review");
});

await tt("LAST MILE: an OLD 'ready' order is held by the worker (approval is the only way through)", async () => {
  seed({ reference: "OLDRDY", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(1000), payment_amount: 206, created_at: minsAgo(1100) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("OLDRDY").fulfillment_status, "manual_review");
});

await tt("FAIL CLOSED: an order with no creation time is treated as too old and held, never delivered", async () => {
  const row = seed({ reference: "NOTIME1" }); delete row.created_at; world.paystack.NOTIME1 = live();
  const r = await verifyAndFulfillOrder("NOTIME1"); assert.equal(r.kind, "held"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("the scheduled worker still delivers a FRESH, recorded, genuine payment (webhook-then-worker path)", async () => {
  seed({ reference: "FRESH1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(1), payment_amount: 206, created_at: minsAgo(4) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(get("FRESH1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1);
});

// ---------------------------------------------------------------- the admin decision
await tt("APPROVE & DELIVER: re-checks Paystack, sends exactly once, records who approved, and a double-click cannot deliver twice", async () => {
  seed({ reference: "APP1", created_at: minsAgo(900) }); world.paystack.APP1 = live();
  await runWorkerCycle({}); assert.equal(world.techlinkCalls.length, 0);
  const [a, b] = await Promise.all([manual("ad", "admin", { reference: "APP1", action: "approve_delivery", note: "confirmed in Paystack dashboard" }), manual("ad", "admin", { reference: "APP1", action: "approve_delivery", note: "confirmed in Paystack dashboard" })]);
  assert.equal(get("APP1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1, "double click must not double-deliver");
  assert.equal(audit("admin_approve_delivery").length >= 1, true); assert.ok([a.code, b.code].includes(200));
});

await tt("APPROVE & DELIVER refuses a TEST-mode payment even for an admin, and sends nothing", async () => {
  asProduction(); seed({ reference: "APP2", created_at: minsAgo(900) }); world.paystack.APP2 = live({ domain: "test" });
  const r = await manual("ad", "admin", { reference: "APP2", action: "approve_delivery", note: "trying anyway" });
  assert.equal(r.code, 409); assert.equal(world.techlinkCalls.length, 0); assert.equal(audit("admin_approve_delivery_refused").length, 1);
});

await tt("APPROVE & DELIVER refuses an unpaid order (Paystack says abandoned)", async () => {
  seed({ reference: "APP3", created_at: minsAgo(900) }); world.paystack.APP3 = { status: "abandoned", amount: 206, currency: "GHS" };
  const r = await manual("ad", "admin", { reference: "APP3", action: "approve_delivery", note: "customer says they paid" });
  assert.equal(r.code, 409); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("APP3").fulfilled, false);
});

await tt("APPROVE & DELIVER refuses an underpayment", async () => {
  seed({ reference: "APP4", created_at: minsAgo(900) }); world.paystack.APP4 = live({ amount: 100 });
  const r = await manual("ad", "admin", { reference: "APP4", action: "approve_delivery", note: "short" }); assert.equal(r.code, 409); assert.equal(world.techlinkCalls.length, 0);
});

await tt("APPROVE & DELIVER will not deliver twice when Techlink already shows it; only an admin can force", async () => {
  seed({ reference: "APP5", created_at: minsAgo(900) }); world.paystack.APP5 = live(); world.techlinkOrders = [delivered()];
  const op = await manual("op", "operator", { reference: "APP5", action: "approve_delivery", note: "retry please", force: true }); assert.equal(op.code, 403); assert.equal(world.techlinkCalls.length, 0);
  const ad = await manual("ad", "admin", { reference: "APP5", action: "approve_delivery", note: "verified it never arrived", force: true }); assert.equal(ad.code, 200, JSON.stringify(ad.body)); assert.equal(world.techlinkCalls.length, 1);
});

await tt("'Verify with Paystack' on an unpaid checkout records the answer and NEVER delivers", async () => {
  seed({ reference: "VER1", created_at: minsAgo(20) }); world.paystack.VER1 = live();
  const r = await manual("op", "operator", { reference: "VER1", action: "verify_and_process", note: "checking" }); assert.equal(r.code, 200);
  assert.equal(r.body.result.deliveries, 0); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("VER1").fulfillment_status, "manual_review");
});

await tt("process_now / mark_paid_send / accept_charged by an admin still deliver (explicit decisions)", async () => {
  seed({ reference: "PN1", status: "payment_verified", fulfillment_status: "ready", created_at: minsAgo(900) });
  assert.equal((await manual("ad", "admin", { reference: "PN1", action: "process_now", note: "push it now" })).code, 200); assert.equal(get("PN1").fulfilled, true);
  seed({ reference: "MPS1", created_at: minsAgo(900) });
  assert.equal((await manual("ad", "admin", { reference: "MPS1", action: "mark_paid_send", note: "paid by MoMo, confirmed" })).code, 200); assert.equal(get("MPS1").fulfilled, true);
});

// ---------------------------------------------------------------- the switch, and what the browser can see
await tt("delivery-mode endpoint: operators read it, only admins change it, the change is audited", async () => {
  const g = await call("pages/api/admin/delivery-mode.js", "op", "operator"); assert.equal(g.code, 200); assert.equal(g.body.mode, "automatic");
  assert.equal((await call("pages/api/admin/delivery-mode.js", "op", "operator", { method: "POST", body: { mode: "manual" } })).code, 403);
  assert.equal((await call("pages/api/admin/delivery-mode.js", "ad", "admin", { method: "POST", body: { mode: "bogus" } })).code, 400);
  assert.equal((await call("pages/api/admin/delivery-mode.js", "ad", "admin", { method: "POST", body: { mode: "manual" } })).code, 200);
  assert.equal(await getDeliveryMode(), "manual"); assert.equal(audit("admin_changed_delivery_mode").length, 1);
  assert.equal((await call("pages/api/admin/delivery-mode.js", null, null)).code, 401);
});

await tt("delivery mode fails CLOSED: if the setting cannot be read, nothing is delivered automatically", async () => {
  memdb.db.failTable = "app_settings"; let mode; try { mode = await getDeliveryMode(); } finally { memdb.db.failTable = null; }
  assert.equal(mode, "manual");
});

await tt("payment-check never hands the raw Paystack response to the browser", async () => {
  seed({ reference: "PC1", status: "payment_failed", fail_reason: "amount_mismatch" }); world.paystack.PC1 = live({ customer: { email: "secret@x.com" }, authorization: { last4: "4081", bin: "408408" } });
  const r = await call("pages/api/admin/payment-check.js", "op", "operator", { query: { reference: "PC1" } });
  assert.equal(r.code, 200); const text = JSON.stringify(r.body); assert.equal(text.includes("secret@x.com"), false); assert.equal(text.includes("4081"), false); assert.equal(r.body.domain, "live"); assert.equal(r.body.transactionId, "987654321");
});

await tt("health reports the Paystack key mode and delivery mode", async () => {
  const r = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(r.code, 200); assert.ok(["live", "test", "unknown"].includes(r.body.paystack.keyMode)); assert.equal(r.body.delivery.mode, "automatic");
});

// ---------------------------------------------------------------- order numbers
await tt("every new order gets OUR order number (PJ-XXXXXXXX), distinct from the Paystack reference", async () => {
  const o = await store.createOrder({ reference: "TLREF0001", orderType: "airtime", network: "mtn", phone: "0551864239", email: "c@d.co", amount: 2, checkoutAmount: 2.06 });
  assert.match(o.orderNo, /^PJ-[A-Z2-9]{8}$/); assert.equal(o.reference, "TLREF0001"); assert.notEqual(o.orderNo, o.reference);
  const pub = store.toPublicOrder({ ...o, paystackTransactionId: "123" });
  assert.equal(pub.orderNo, o.orderNo); assert.equal(pub.paystackReference, "TLREF0001"); assert.equal(pub.paystackTransactionId, "123"); assert.equal(pub.phoneMasked, "055•••4239");
});

await tt("a customer can find an order by our order number or by the Paystack reference (same email only)", async () => {
  const o = await store.createOrder({ reference: "TLREF0002", orderType: "airtime", network: "mtn", phone: "0551864239", email: "c@d.co", amount: 2 });
  assert.equal((await store.findCustomerOrder("TLREF0002", "c@d.co")).reference, "TLREF0002");
  assert.equal((await store.findCustomerOrder(o.orderNo, "c@d.co")).reference, "TLREF0002");
  assert.equal(await store.findCustomerOrder(o.orderNo, "someone-else@x.com"), null);
});

await tt("checkout still works if the order_no migration has not been run yet", async () => {
  memdb.db.missingColumns = new Set(["order_no"]); let o; try { o = await store.createOrder({ reference: "TLREF0003", orderType: "airtime", network: "mtn", phone: "0551864239", email: "c@d.co", amount: 2 }); } finally { memdb.db.missingColumns = null; }
  assert.equal(o.reference, "TLREF0003"); assert.equal(store.toPublicOrder(o).orderNo, "TLREF0003", "falls back to the reference for display");
});

// ---------------------------------------------------------------- review round 2: hidden defects found in v1.4.0 itself
await tt("DEAD END: a checkout whose popup never opened (Paystack has no record) is closed after a grace period, with no error every check", async () => {
  seed({ reference: "GHOST1", created_at: minsAgo(90) }); seed({ reference: "GHOST2", created_at: minsAgo(20) }); // Paystack knows neither
  const r = await runWorkerCycle({ batchSize: 10, sweepLimit: 20 });
  assert.equal(r.sweep.errors, 0, "an unknown reference must not be counted as an error: " + JSON.stringify(r.sweep));
  assert.equal(get("GHOST1").status, "payment_failed"); assert.equal(get("GHOST1").fail_reason, "payment_abandoned", "closed, and hidden from customers like other abandoned checkouts");
  assert.equal(get("GHOST2").status, "pending", "still inside the grace period: left alone"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("DEAD END: the customer's own verify of a not-yet-opened checkout answers 'still processing', not an error", async () => {
  seed({ reference: "GHOST3", created_at: minsAgo(3) });
  const r = await verifyAndFulfillOrder("GHOST3"); assert.equal(r.kind, "payment_pending"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("FALSE HOLD: a genuinely paid order is still delivered when the cron runs an hour late (age is judged at payment discovery, not at delivery)", async () => {
  seed({ reference: "SLOW1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(67), payment_amount: 206, created_at: minsAgo(70) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(get("SLOW1").fulfilled, true, "late cron must not strand a paid order"); assert.equal(world.techlinkCalls.length, 1);
});

await tt("a verified order stuck for many hours is NOT retried automatically (a person decides)", async () => {
  seed({ reference: "STALE1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(60 * 12), payment_amount: 206, created_at: minsAgo(60 * 12 + 3) });
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("STALE1").fulfillment_status, "manual_review");
});

await tt("FALSE HOLD: a one-second database blip reading the delivery mode does not convert paid orders into manual approvals", async () => {
  seed({ reference: "BLIP1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(1), payment_amount: 206, created_at: minsAgo(3) });
  memdb.db.failTable = "app_settings"; try { await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); } finally { memdb.db.failTable = null; }
  assert.equal(world.techlinkCalls.length, 0, "unknown mode: nothing is sent"); assert.equal(get("BLIP1").fulfillment_status, "ready", "but the order must stay ready, not be parked for manual approval");
  await runWorkerCycle({ batchSize: 10, sweepLimit: 20 }); assert.equal(get("BLIP1").fulfilled, true, "delivered on the next cycle once the setting is readable");
});

await tt("a mode-read failure while verifying a payment is retried (webhook job retries), never turned into a hold", async () => {
  seed({ reference: "BLIP2", created_at: minsAgo(2) }); world.paystack.BLIP2 = live();
  memdb.db.failTable = "app_settings"; let threw = false; try { await verifyAndFulfillOrder("BLIP2"); } catch { threw = true; } finally { memdb.db.failTable = null; }
  assert.equal(threw, true); assert.notEqual(get("BLIP2").fulfillment_status, "manual_review"); assert.equal(world.techlinkCalls.length, 0);
  const r = await verifyAndFulfillOrder("BLIP2"); assert.equal(get("BLIP2").fulfilled, true, JSON.stringify(r).slice(0, 160));
});

await tt("DEAD END: a checkout closed as 'abandoned' that Paystack later CONFIRMS as paid is recovered, not silently lost (automatic mode, fresh)", async () => {
  seed({ reference: "LATE1", status: "payment_failed", fail_reason: "payment_abandoned", created_at: minsAgo(8) }); world.paystack.LATE1 = live();
  await verifyAndFulfillOrder("LATE1"); assert.equal(get("LATE1").fulfilled, true, "paid money must end in a delivery"); assert.equal(world.techlinkCalls.length, 1);
});

await tt("DEAD END: the same abandoned-then-paid order in MANUAL mode becomes a visible 'awaiting approval' item, not an invisible no-op", async () => {
  await setDeliveryMode("manual", "ad");
  seed({ reference: "LATE2", status: "payment_failed", fail_reason: "payment_abandoned", created_at: minsAgo(8) }); world.paystack.LATE2 = live();
  const r = await verifyAndFulfillOrder("LATE2");
  assert.equal(r.kind, "held"); assert.equal(get("LATE2").status, "payment_verified", "must actually change state, not just claim it did"); assert.equal(get("LATE2").fulfillment_status, "manual_review"); assert.equal(get("LATE2").payment_amount, 206);
  assert.equal(world.techlinkCalls.length, 0);
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.ok(list.body.orders.some((o) => o.reference === "LATE2" && o.category === "held"), "must appear on the Needs attention list");
});

await tt("APPROVE & DELIVER recovers an abandoned-then-paid order for an admin, after re-checking Paystack", async () => {
  seed({ reference: "LATE3", status: "payment_failed", fail_reason: "payment_abandoned", created_at: minsAgo(600) }); world.paystack.LATE3 = live();
  const r = await manual("ad", "admin", { reference: "LATE3", action: "approve_delivery", note: "customer shared MoMo receipt" }); assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(get("LATE3").fulfilled, true); assert.equal(world.techlinkCalls.length, 1);
});

await tt("a SECOND Paystack notification for an order already accepted and queued with Techlink is a quiet no-op (no error, no re-hold, no second delivery)", async () => {
  seed({ reference: "DUP1", status: "payment_verified", fulfillment_status: "queued_with_provider", payment_verified_at: minsAgo(80), payment_amount: 206, created_at: minsAgo(100), provider_order_id: "ORD-X" }); world.paystack.DUP1 = live();
  const r = await verifyAndFulfillOrder("DUP1"); assert.notEqual(r.kind, "held"); assert.equal(get("DUP1").fulfillment_status, "queued_with_provider"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("a late verify of an order that is already HELD leaves it held: nothing delivered, nothing thrown", async () => {
  seed({ reference: "DUP2", status: "payment_verified", fulfillment_status: "manual_review", fail_reason: "held_for_approval", payment_verified_at: minsAgo(30), payment_amount: 206, created_at: minsAgo(40) }); world.paystack.DUP2 = live();
  const r = await verifyAndFulfillOrder("DUP2"); assert.equal(get("DUP2").fulfillment_status, "manual_review"); assert.equal(get("DUP2").fulfilled, false); assert.equal(world.techlinkCalls.length, 0);
});

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
