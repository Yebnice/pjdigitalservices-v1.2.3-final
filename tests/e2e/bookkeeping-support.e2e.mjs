// End-to-end: bookkeeping accuracy and customer-facing consistency.
// Run with: node --import ./tests/e2e/loader/register.mjs tests/e2e/bookkeeping-support.e2e.mjs
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
process.env.BREVO_API_KEY = "brevo_test"; process.env.BREVO_SMS_SENDER = "PjDigital";
const baseFetch = globalThis.fetch; const sent = { emails: [], sms: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.resend.com/emails")) { sent.emails.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ id: "e1" }), text: async () => "{}" }; }
  if (u.includes("brevo.com")) { sent.sms.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ messageId: "s1" }), text: async () => "{}" }; }
  return baseFetch(url, opts);
};
const notif = await load("lib/notifications.js");
const sign = (raw) => crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
const postWebhook = async (eventObj, { badSig = false } = {}) => {
  const raw = JSON.stringify(eventObj); const { EventEmitter } = await import("node:events");
  const req = new EventEmitter(); req.method = "POST"; req.headers = { "x-paystack-signature": badSig ? "0".repeat(128) : sign(raw) };
  const res = mkRes(); const h = (await load("pages/api/paystack/webhook.js")).default;
  const p = h(req, res); setImmediate(() => { req.emit("data", Buffer.from(raw)); req.emit("end"); }); await p; return res;
};
const tt = async (name, fn) => { await t(name, async () => { sent.emails.length = 0; sent.sms.length = 0; await fn(); }); };
const withNo = (ref, no, over = {}) => seed({ reference: ref, order_no: no, created_at: minsAgo(5), ...over });

// ============================ A. RECONCILIATION: money is compared in whole pesewas, never in floats
const csvOf = (rows) => "Reference,Amount,Status\n" + rows.map((r) => `${r[0]},${r[1]},${r[2] || "success"}`).join("\n");
const reconcile = (csv) => call("pages/api/admin/reconcile.js", "op", "operator", { method: "POST", body: { csv } });

await tt("RECONCILE: a ONE-PESEWA difference is always reported, for every amount (float noise must not hide it)", async () => {
  const pairs = [[4.59, 4.58], [4.60, 4.59], [102.0, 101.99], [10.2, 10.19], [0.3, 0.29], [1.1, 1.09], [2.06, 2.05], [7.77, 7.76]];
  pairs.forEach(([app], i) => seed({ reference: `RC${i}`, status: "success", fulfilled: true, checkout_amount: app }));
  const r = await reconcile(csvOf(pairs.map(([, ps], i) => [`RC${i}`, ps.toFixed(2)])));
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.counts.mismatched, pairs.length, "all 8 one-pesewa differences must be flagged, got " + r.body.counts.mismatched); assert.equal(r.body.counts.matched, 0);
});

await tt("RECONCILE: exact amounts still match (including thousands separators and a currency prefix)", async () => {
  seed({ reference: "RM1", status: "success", fulfilled: true, checkout_amount: 1234.5 }); seed({ reference: "RM2", status: "success", fulfilled: true, checkout_amount: 102.0 });
  const r = await reconcile('Reference,Amount,Status\nRM1,"GHS 1,234.50",success\nRM2,102.00,success');
  assert.equal(r.body.counts.matched, 2); assert.equal(r.body.counts.mismatched, 0);
});

// ============================ B. CUSTOMER SERVICE: one order number everywhere the customer looks
await tt("SUPPORT: the 'delivered' email leads with the order number AND keeps the Paystack reference", async () => {
  withNo("TLDEL001", "PJ-7KQ2M9XA", { status: "success", fulfilled: true });
  await notif.notifyCustomerOrderFulfilled(await store.getOrder("TLDEL001"));
  const m = sent.emails[0]; assert.ok(m, "an email must be sent");
  assert.ok(m.subject.includes("PJ-7KQ2M9XA") && !m.subject.includes("TLDEL001"), "subject: " + m.subject);
  assert.ok(m.text.includes("Order number: PJ-7KQ2M9XA") && m.text.includes("Paystack reference: TLDEL001"), m.text);
});

await tt("SUPPORT: queued and 'still processing' emails use the same order number", async () => {
  withNo("TLQ00001", "PJ-ABCD2345");
  const o = await store.getOrder("TLQ00001"); await notif.notifyCustomerOrderQueued(o); await notif.notifyCustomerProcessingDelay(o);
  assert.equal(sent.emails.length, 2);
  for (const m of sent.emails) { assert.ok(m.subject.includes("PJ-ABCD2345"), "subject: " + m.subject); assert.ok(m.text.includes("PJ-ABCD2345") && m.text.includes("TLQ00001"), m.text); }
});

await tt("SUPPORT: the delivery SMS carries the order number and stays within one 160-character message", async () => {
  withNo("TLSMS001", "PJ-WXYZ2345", { phone: "0551864239" });
  await notif.notifyCustomerOrderSms(await store.getOrder("TLSMS001"));
  const m = sent.sms[0]; assert.ok(m, "an SMS must be sent"); assert.ok(m.content.includes("PJ-WXYZ2345"), m.content); assert.ok(m.content.length <= 160, `length ${m.content.length}: ${m.content}`);
});

await tt("SUPPORT: an order from before the migration (no order number) still gets a clear email using its reference", async () => {
  seed({ reference: "TLOLD001", status: "success", fulfilled: true, created_at: minsAgo(5) });
  await notif.notifyCustomerOrderFulfilled(await store.getOrder("TLOLD001")); const m = sent.emails[0];
  assert.ok(m.subject.includes("TLOLD001") && m.text.includes("TLOLD001") && !/undefined|null/.test(m.subject + m.text), m.subject + "\n" + m.text);
});

// ============================ C. BOOKKEEPING: refunds and disputes must leave a trace
const auditRows = (prefix) => memdb.db.tables.audit_log.filter((a) => a.action.startsWith(prefix));

await tt("BOOKS: a signed refund.processed event on a DELIVERED order is recorded against that order; delivery state is untouched", async () => {
  withNo("TLREF001", "PJ-REFD2345", { status: "success", fulfilled: true, fulfillment_status: "fulfilled", checkout_amount: 4.59 });
  // NOTE: Paystack's exact refund/dispute payload field names are not verified. The handler must not depend on them,
  // so this synthetic payload buries the reference at an arbitrary place.
  const res = await postWebhook({ event: "refund.processed", data: { status: "processed", amount: 459, currency: "GHS", detail: { transaction_ref: "TLREF001" } } });
  assert.equal(res.code, 200);
  const rows = auditRows("paystack_refund"); assert.equal(rows.length, 1, "one audit row, got " + JSON.stringify(memdb.db.tables.audit_log.map((a) => a.action)));
  assert.equal(rows[0].reference, "TLREF001"); assert.ok(rows[0].note.includes("PJ-REFD2345") && /delivered/i.test(rows[0].note), rows[0].note);
  assert.equal(get("TLREF001").fulfilled, true); assert.equal(get("TLREF001").status, "success"); assert.equal(world.techlinkCalls.length, 0);
});

await tt("BOOKS: a dispute event is recorded the same way, and an event matching no order is still recorded (not lost)", async () => {
  withNo("TLDSP001", "PJ-DISP2345", { status: "success", fulfilled: true });
  assert.equal((await postWebhook({ event: "charge.dispute.create", data: { reference: "TLDSP001", amount: 459 } })).code, 200);
  assert.equal(auditRows("paystack_dispute")[0].reference, "TLDSP001");
  assert.equal((await postWebhook({ event: "refund.processed", data: { amount: 100, note: "unknown-ref-123456" } })).code, 200);
  assert.equal(auditRows("paystack_refund").length, 1); assert.equal(auditRows("paystack_refund")[0].reference, null); assert.ok(/no matching order/i.test(auditRows("paystack_refund")[0].note));
});

await tt("BOOKS: reversal events need a valid Paystack signature (a forged refund notice is rejected and recorded nowhere)", async () => {
  withNo("TLFRG001", "PJ-FRGD2345", { status: "success", fulfilled: true });
  const res = await postWebhook({ event: "refund.processed", data: { reference: "TLFRG001" } }, { badSig: true });
  assert.equal(res.code, 401); assert.equal(auditRows("paystack_refund").length, 0);
});

await tt("BOOKS: charge.success still queues exactly as before, and unrelated events are acknowledged without work", async () => {
  seed({ reference: "TLCS0001", created_at: minsAgo(2) });
  const ok = await postWebhook({ event: "charge.success", data: { reference: "TLCS0001", status: "success" } }); assert.equal(ok.code, 200); assert.equal(memdb.db.tables.paystack_webhook_events.length, 1);
  const other = await postWebhook({ event: "subscription.create", data: { reference: "TLCS0001" } }); assert.equal(other.code, 200); assert.equal(memdb.db.tables.paystack_webhook_events.length, 1); assert.equal(auditRows("paystack_").length, 0);
});

await tt("BOOKS: the same notice delivered twice (Paystack retries) leaves ONE audit row", async () => {
  withNo("TLDUP001", "PJ-DUPL2345", { status: "success", fulfilled: true });
  const ev = { event: "refund.processed", data: { transaction_reference: "TLDUP001", amount: 459 } };
  await postWebhook(ev); await postWebhook(ev); assert.equal(auditRows("paystack_refund").length, 1);
  await postWebhook({ event: "refund.failed", data: { transaction_reference: "TLDUP001" } }); assert.equal(auditRows("paystack_refund").length, 2, "a different event for the same order is a new fact");
});

await tt("BOOKS: it does not matter WHERE in the payload the reference sits (field names are not assumed)", async () => {
  withNo("TLSHP001", "PJ-SHPA2345", { status: "success", fulfilled: true });
  for (const [i, data] of [{ transaction: { reference: "TLSHP001" } }, { refund: { transaction: { ref: ["x", "TLSHP001"] } } }, { reference: "TLSHP001" }].entries()) {
    await postWebhook({ event: "charge.dispute.remind", data: { ...data, n: i } });
  }
  assert.equal(auditRows("paystack_dispute").filter((a) => a.reference === "TLSHP001").length, 3);
});

await tt("BOOKS: if the database fails while recording, the webhook answers 5xx so Paystack retries (the notice is not lost)", async () => {
  memdb.db.failTable = "orders"; let res; try { res = await postWebhook({ event: "refund.processed", data: { reference: "TLFAIL001" } }); } finally { memdb.db.failTable = null; }
  assert.equal(res.code, 500);
});

await tt("RECONCILE: a refund-style NEGATIVE row is not read as a normal payment", async () => {
  seed({ reference: "RN1", status: "success", fulfilled: true, checkout_amount: 4.59 }); seed({ reference: "RN2", status: "success", fulfilled: true, checkout_amount: 4.59 });
  const r = await reconcile('Reference,Amount,Status\nRN1,-4.59,success\nRN2,"(4.59)",success');
  assert.equal(r.body.counts.matched, 0); assert.equal(r.body.counts.mismatched, 2);
});

await tt("RECONCILE: a mismatch reports the exact difference in GHS", async () => {
  seed({ reference: "RD1", status: "success", fulfilled: true, checkout_amount: 102.0 });
  const r = await reconcile(csvOf([["RD1", "101.99"]])); assert.equal(r.body.mismatched[0].differenceGhs, -0.01);
});

await tt("HEALTH: the dashboard learns how many refund/dispute notices arrived in the last 30 days", async () => {
  withNo("TLHL0001", "PJ-HLTH2345", { status: "success", fulfilled: true });
  await postWebhook({ event: "refund.processed", data: { reference: "TLHL0001" } });
  const h = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(h.code, 200); assert.equal(h.body.reversals.last30d, 1);
});


await tt("BOOKS: a successful Paystack charge with an amount mismatch is recorded as charged-but-rejected, not payment_failed", async () => {
  withNo("TLCRJ001", "PJ-CRJ12345", { amount: 2, checkout_amount: 2.06, customer_product_amount: 2, business_markup_amount: 0 });
  world.paystack.TLCRJ001 = { status: "success", amount: 205, currency: "GHS", fees: 4, domain: "live", id: 987654321, paid_at: minsAgo(2) };
  const { verifyAndPrepareOrder } = await load("lib/orderProcessing.js");
  const r = await verifyAndPrepareOrder("TLCRJ001");
  assert.equal(r.kind, "failed");
  assert.equal(get("TLCRJ001").status, "payment_rejected_after_charge");
  assert.equal(get("TLCRJ001").failReason, "amount_mismatch");
  assert.equal(get("TLCRJ001").paymentAmount, 205);
  assert.equal(get("TLCRJ001").paystackTransactionId, "987654321");
  assert.ok(get("TLCRJ001").paymentChargedAt);
  assert.equal(get("TLCRJ001").fulfillmentStatus, "not_applicable");
  assert.equal(get("TLCRJ001").paymentVerifiedAt, null);
  assert.equal(world.techlinkCalls.length, 0);
});

await tt("BOOKS: a successful Paystack charge without a currency is rejected as charged money, never accepted as GHS", async () => {
  withNo("TLCUR001", "PJ-CUR12345", { amount: 2, checkout_amount: 2.06 });
  world.paystack.TLCUR001 = { status: "success", amount: 206, fees: 4, domain: "live", id: 987654322, paid_at: minsAgo(1) };
  const { verifyAndPrepareOrder } = await load("lib/orderProcessing.js");
  const r = await verifyAndPrepareOrder("TLCUR001");
  assert.equal(r.status, "currency_mismatch");
  assert.equal(get("TLCUR001").status, "payment_rejected_after_charge");
  assert.equal(get("TLCUR001").paymentAmount, 206);
  assert.equal(get("TLCUR001").paymentVerifiedAt, null);
  assert.equal(get("TLCUR001").fulfillmentStatus, "not_applicable");
  assert.equal(world.techlinkCalls.length, 0);
});

await tt("BOOKS: a non-genuine successful response does not record its amount as customer money", async () => {
  withNo("TLNG001", "PJ-NG123456", { amount: 2, checkout_amount: 2.06 });
  world.paystack.TLNG001 = { status: "success", amount: 206, currency: "GHS", domain: "live", id: 987654323, reference: "SOME-OTHER-REFERENCE" };
  const { verifyAndPrepareOrder } = await load("lib/orderProcessing.js");
  const r = await verifyAndPrepareOrder("TLNG001");
  assert.equal(r.status, "reference_mismatch");
  assert.equal(get("TLNG001").status, "payment_failed");
  assert.equal(get("TLNG001").paymentAmount, null);
  assert.equal(get("TLNG001").paymentVerifiedAt, null);
  assert.equal(get("TLNG001").fulfillmentStatus, "not_applicable");
  assert.equal(world.techlinkCalls.length, 0);
});

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
