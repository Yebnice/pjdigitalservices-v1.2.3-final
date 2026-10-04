// End-to-end: paid-but-missed recovery, charged-but-rejected payments, Techlink evidence, manual control, worker health
// Run with: npm run test:e2e   (Node 22+; uses tests/e2e/loader to run the real app code against an in-memory database)
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const load = (rel) => import(pathToFileURL(ROOT + rel).href);
import assert from "node:assert"; import crypto from "node:crypto";
process.env.RESEND_API_KEY = "re_test"; process.env.NOTIFICATION_FROM_EMAIL = "PjDigital <noreply@pjdigitalservices.online>"; process.env.NODE_ENV = "test";
process.env.PAYSTACK_SECRET_KEY = "sk_test_x"; process.env.TECHLINK_API_KEY = "tlg_test_x";
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

await t("PAID-BUT-MISSED: a checkout stuck at 'pending' that Paystack says was paid is RECORDED and HELD for approval; nothing is sent to Techlink", async () => {
  const o = seed({ reference: "PAID1" }); world.paystack.PAID1 = { status: "success", amount: 206, currency: "GHS" };
  const r = await runWorkerCycle({ batchSize: 3, sweepLimit: 8 });
  assert.equal(r.sweep.checked, 1); assert.equal(r.sweep.paidHeld, 1); assert.equal(r.sweep.deliveries, 0);
  const row = get("PAID1");
  assert.equal(row.fulfilled, false, "an outstanding-orders check must never deliver"); assert.equal(row.status, "payment_verified"); assert.equal(row.fulfillment_status, "manual_review"); assert.equal(row.payment_amount, 206);
  assert.equal(world.techlinkCalls.length, 0, "NOTHING may reach Techlink from the check");
  assert.equal(audit("paid_order_held_for_approval").length, 1);
  assert.equal(r.failures.length, 0, JSON.stringify(r.failures));
});
await t("ABANDONED: a checkout Paystack says was never paid is closed, and nothing is sent to Techlink", async () => {
  seed({ reference: "GONE1" }); world.paystack.GONE1 = { status: "abandoned", amount: 206, currency: "GHS" };
  const r = await runWorkerCycle({}); assert.equal(r.sweep.closed, 1);
  assert.equal(get("GONE1").status, "payment_failed"); assert.equal(get("GONE1").fail_reason, "payment_abandoned", "the code customers' lists and the admin Abandoned filter recognise"); assert.equal(world.techlinkCalls.length, 0);
});
await t("a checkout younger than 10 minutes is left alone (customer may still be paying)", async () => {
  seed({ reference: "NEW1", created_at: minsAgo(2) }); world.paystack.NEW1 = { status: "success", amount: 206, currency: "GHS" };
  const r = await runWorkerCycle({}); assert.equal(r.sweep.checked, 0); assert.deepEqual(world.paystackCalls, []); assert.equal(get("NEW1").status, "pending");
});
await t("still-pending at Paystack (mobile money prompt open) stays pending and is retried next run", async () => {
  seed({ reference: "MOMO1" }); world.paystack.MOMO1 = { status: "ongoing", amount: 206, currency: "GHS" };
  const r = await runWorkerCycle({}); assert.equal(r.sweep.stillPending, 1); assert.equal(get("MOMO1").status, "payment_pending"); assert.equal(world.techlinkCalls.length, 0);
  world.paystack.MOMO1.status = "success"; const r2 = await runWorkerCycle({}); assert.equal(get("MOMO1").fulfilled, false, "the check must not deliver"); assert.equal(get("MOMO1").fulfillment_status, "manual_review", "once paid it waits for approval"); assert.equal(world.techlinkCalls.length, 0);
});
await t("LATE PAYMENT: an order marked abandoned that is later paid is recovered by the webhook path", async () => {
  seed({ reference: "LATE1", status: "payment_failed", fail_reason: "payment_abandoned" }); world.paystack.LATE1 = { status: "success", amount: 206, currency: "GHS" };
  const { verifyAndFulfillOrder } = await load("lib/orderProcessing.js"); const r = await verifyAndFulfillOrder("LATE1"); assert.equal(r.kind, "fulfilled");
});
await t("PAYSTACK OUTAGE turns the worker red instead of silently doing nothing", async () => {
  seed({ reference: "OUT1" }); world.paystackDown = true; const r = await runWorkerCycle({});
  assert.equal(r.sweep.errors, 1); assert.ok(r.failures.some((f) => f.step === "stale-pending-sweep")); assert.equal(get("OUT1").status, "pending");
});
await t("one broken order does not stop the rest of the sweep", async () => {
  seed({ reference: "OK1" }); seed({ reference: "BAD1" }); world.paystack.OK1 = { status: "success", amount: 206, currency: "GHS" };
  const r = await runWorkerCycle({}); assert.equal(get("OK1").fulfillment_status, "manual_review"); assert.equal(get("OK1").fulfilled, false); assert.equal(r.sweep.checked, 2); assert.equal(world.techlinkCalls.length, 0);
});
await t("HEARTBEAT is written every run and the health endpoint reports it", async () => {
  const before = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(before.body.worker.lastRunAt, null);
  await runWorkerCycle({ trigger: "schedule" });
  const after = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(after.code, 200); assert.ok(after.body.worker.ageMinutes <= 1); assert.equal(after.body.worker.lastRunOk, true);
  assert.equal((await call("pages/api/admin/health.js", "vw", "viewer")).code, 403, "viewers must not see system health");
});
await t("CHARGED BUT REJECTED: wrong amount is recorded, audited, and now VISIBLE in Needs Attention", async () => {
  seed({ reference: "MIS1" }); world.paystack.MIS1 = { status: "success", amount: 300, currency: "GHS" };
  const r = await runWorkerCycle({}); assert.equal(r.sweep.rejected, 1);
  const o = get("MIS1"); assert.equal(o.status, "payment_failed"); assert.equal(o.fail_reason, "amount_mismatch"); assert.equal(o.payment_amount, 300);
  assert.equal(audit("payment_charged_but_rejected").length, 1); assert.equal(world.techlinkCalls.length, 0);
  const list = await call("pages/api/orders/manual-review.js", "op", "operator");
  assert.equal(list.code, 200); const row = list.body.orders.find((x) => x.reference === "MIS1"); assert.equal(row.category, "charged_rejected"); assert.equal(row.paymentAmountGhs, 3); assert.equal(list.body.counts.charged_rejected, 1);
});
await t("accept_charged: operator refused; admin accepts an OVERPAYMENT and the customer is served", async () => {
  seed({ reference: "OVR1" }); world.paystack.OVR1 = { status: "success", amount: 300, currency: "GHS" }; await runWorkerCycle({});
  const op = await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "OVR1", action: "accept_charged", note: "customer overpaid" } }); assert.equal(op.code, 403);
  const ad = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "OVR1", action: "accept_charged", note: "customer overpaid" } });
  assert.equal(ad.code, 200, JSON.stringify(ad.body)); assert.equal(get("OVR1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1); assert.equal(audit("admin_accept_charged").length, 1);
});
await t("accept_charged REFUSES an underpayment and sends nothing", async () => {
  seed({ reference: "UND1" }); world.paystack.UND1 = { status: "success", amount: 100, currency: "GHS" }; await runWorkerCycle({});
  const ad = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "UND1", action: "accept_charged", note: "trying anyway" } });
  assert.equal(ad.code, 400); assert.ok(/underpaid|paid GHS 1\.00/i.test(ad.body.error), ad.body.error); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("UND1").fulfilled, false);
  const check = await call("pages/api/admin/payment-check.js", "op", "operator", { query: { reference: "UND1" } }); assert.equal(check.body.verdict, "underpaid"); assert.equal(check.body.difference, -1.06);
});
await t("close_charged: admin only, removes it from the list, keeps the record", async () => {
  seed({ reference: "CLS1" }); world.paystack.CLS1 = { status: "success", amount: 100, currency: "GHS" }; await runWorkerCycle({});
  assert.equal((await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "CLS1", action: "close_charged", note: "refunded via paystack" } })).code, 403);
  const r = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "CLS1", action: "close_charged", note: "refunded via paystack" } }); assert.equal(r.code, 200);
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.ok(!list.body.orders.some((x) => x.reference === "CLS1")); assert.ok(get("CLS1").manual_review_resolution.includes("refunded"));
});
await t("wrong CURRENCY is treated as charged-but-rejected too", async () => {
  seed({ reference: "USD1" }); world.paystack.USD1 = { status: "success", amount: 206, currency: "USD" }; await runWorkerCycle({});
  assert.equal(get("USD1").fail_reason, "currency_mismatch"); const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.equal(list.body.orders.find((x) => x.reference === "USD1").category, "charged_rejected");
});

const delivered = (over = {}) => ({ orderId: "ORD-TL1", productType: "Airtime", phoneNumber: "0241234567", amount: 2.04, costPrice: 2, status: "completed", createdAt: minsAgo(20), ...over });
await t("EVIDENCE: 'retry' is BLOCKED when Techlink's history shows the order was already delivered", async () => {
  seed({ reference: "RET1", status: "payment_verified", fulfillment_status: "failed", payment_verified_at: minsAgo(25) }); world.techlinkOrders = [delivered()];
  const r = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "RET1", action: "retry", note: "customer says not received" } });
  assert.equal(r.code, 409); assert.equal(r.body.evidence.verdict, "delivered"); assert.equal(get("RET1").fulfillment_status, "failed", "must not have been re-queued");
  const forced = await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "RET1", action: "retry", note: "x1234", force: true } }); assert.equal(forced.code, 403, "an operator cannot spend wallet money, let alone force a retry (the relaxed-policy case is tested in techlink-contract)");
});
await t("EVIDENCE: an admin can force a retry, and it is audited", async () => {
  seed({ reference: "RET2", status: "payment_verified", fulfillment_status: "failed", payment_verified_at: minsAgo(25) }); world.techlinkOrders = [delivered()];
  const r = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "RET2", action: "retry", note: "verified with Techlink support it did not arrive", force: true } });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(get("RET2").fulfilled, true, "the admin's forced retry IS the approval, so it is sent now"); assert.equal(world.techlinkCalls.length, 1); assert.equal(audit("admin_forced_retry").length, 1);
});
await t("EVIDENCE: retry is ALLOWED when Techlink has no record (payment never reached Techlink)", async () => {
  seed({ reference: "RET3", status: "payment_verified", fulfillment_status: "failed", payment_verified_at: minsAgo(25) }); world.techlinkOrders = [delivered({ phoneNumber: "0209999999" })];
  const chk = await call("pages/api/admin/techlink-check.js", "op", "operator", { query: { reference: "RET3" } }); assert.equal(chk.body.evidence.verdict, "not_found"); assert.equal(chk.body.retrySafe, true);
  const r = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "RET3", action: "retry", note: "never reached techlink" } }); assert.equal(r.code, 200); assert.equal(get("RET3").fulfilled, true, "authorised retry sends it now, with the admin's approval"); assert.equal(world.techlinkCalls.length, 1);
});
await t("EVIDENCE: a failed Techlink lookup never blocks an admin (verdict unknown)", async () => {
  seed({ reference: "RET4", status: "payment_verified", fulfillment_status: "failed" }); const real = globalThis.fetch; globalThis.fetch = async (u, o) => (String(u).includes("/orders?page=") ? { ok: false, status: 500, json: async () => ({}), text: async () => "", headers: new Map() } : real(u, o));
  const r = await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "RET4", action: "retry", note: "techlink history is down" } }); globalThis.fetch = real; assert.equal(r.code, 200);
});
await t("EVIDENCE: the same delivered Techlink row is NOT credited to two orders (already claimed by another)", async () => {
  seed({ reference: "OLD1", status: "success", fulfilled: true, fulfillment_status: "fulfilled", result: { orderId: "ORD-TL1" }, created_at: minsAgo(60) });
  seed({ reference: "STK1", status: "payment_verified", fulfillment_status: "failed", payment_verified_at: minsAgo(25) }); world.techlinkOrders = [delivered()];
  const chk = await call("pages/api/admin/techlink-check.js", "op", "operator", { query: { reference: "STK1" } }); assert.notEqual(chk.body.evidence.verdict, "delivered", "row belongs to OLD1"); assert.equal(chk.body.retrySafe, true);
});
await t("confirm_from_techlink: closes the order ONLY when Techlink really shows delivered; operators allowed", async () => {
  seed({ reference: "CFM1", status: "payment_verified", fulfillment_status: "queued_with_provider", payment_verified_at: minsAgo(25), result: { orderId: "ORD-TL1" } });
  const no = await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "CFM1", action: "confirm_from_techlink", note: "customer got it" } }); assert.equal(no.code, 409); assert.equal(get("CFM1").fulfilled, false);
  world.techlinkOrders = [delivered()];
  const yes = await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "CFM1", action: "confirm_from_techlink", note: "customer got it" } });
  assert.equal(yes.code, 200, JSON.stringify(yes.body)); assert.equal(get("CFM1").fulfilled, true); assert.ok(audit("manual_review_confirm_from_techlink")[0].note.includes("ORD-TL1"));
  assert.equal((await call("pages/api/orders/manual-review.js", "vw", "viewer", { method: "POST", body: { reference: "CFM1", action: "confirm_from_techlink", note: "abcdef" } })).code, 403);
});
await t("mark-delivered WITHOUT proof is still admin-only", async () => {
  seed({ reference: "MAN1", status: "payment_verified", fulfillment_status: "manual_review" });
  assert.equal((await call("pages/api/orders/manual-review.js", "op", "operator", { method: "POST", body: { reference: "MAN1", action: "confirm_fulfilled", note: "no proof at all" } })).code, 403);
  assert.equal((await call("pages/api/orders/manual-review.js", "ad", "admin", { method: "POST", body: { reference: "MAN1", action: "confirm_fulfilled", note: "no proof at all" } })).code, 200);
});
await t("run-worker endpoint (Check outstanding orders): operator can run it, viewer cannot, it holds a paid-but-missed order and DELIVERS NOTHING", async () => {
  seed({ reference: "RW1" }); world.paystack.RW1 = { status: "success", amount: 206, currency: "GHS" };
  assert.equal((await call("pages/api/admin/run-worker.js", "vw", "viewer", { method: "POST" })).code, 403);
  const r = await call("pages/api/admin/run-worker.js", "op", "operator", { method: "POST" }); assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(get("RW1").fulfilled, false); assert.equal(get("RW1").fulfillment_status, "manual_review"); assert.equal(r.body.deliveries, 0); assert.equal(r.body.paidHeld, 1); assert.equal(r.body.needsAttentionTotal, 1); assert.equal(world.techlinkCalls.length, 0); assert.equal(audit("admin_checked_outstanding_orders").length, 1);
});
await t("the scheduled worker endpoint: wrong secret 401, right secret runs, returns 200 and does not deliver an old unpaid checkout", async () => {
  const h = (await load("pages/api/jobs/fulfill.js")).default;
  const bad = mkRes(); await h({ method: "POST", headers: { authorization: "Bearer nope" } }, bad); assert.equal(bad.code, 401);
  seed({ reference: "CR1" }); world.paystack.CR1 = { status: "success", amount: 206, currency: "GHS" };
  const ok = mkRes(); await h({ method: "POST", headers: { authorization: "Bearer " + process.env.CRON_SECRET } }, ok); assert.equal(ok.code, 200, JSON.stringify(ok.body)); assert.equal(get("CR1").fulfilled, false); assert.equal(get("CR1").fulfillment_status, "manual_review"); assert.equal(world.techlinkCalls.length, 0);
});
await t("Needs Attention list: unpaid checkouts are categorised separately from paid orders", async () => {
  seed({ reference: "U1" }); seed({ reference: "P1", status: "payment_verified", fulfillment_status: "ready" }); seed({ reference: "Q1", status: "payment_verified", fulfillment_status: "queued_with_provider" });
  const r = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.deepEqual(r.body.counts, { charged_rejected: 0, held: 0, ready: 1, queued: 1, retryable: 0, unpaid: 1, paidNeedingAction: 2 });
});

const { getOrderStatusLabel } = await load("lib/orderStatus.js"); const { fromRow } = store;
const statusOf = (ref) => getOrderStatusLabel(fromRow(get(ref)));
const manual = (user, role, body) => call("pages/api/orders/manual-review.js", user, role, { method: "POST", body });

await t("MANUAL: admin can mark an UNPAID order delivered (Paystack/Techlink APIs not involved), customer is told", async () => {
  seed({ reference: "MD1", status: "pending" });
  const r = await manual("ad", "admin", { reference: "MD1", action: "mark_delivered", note: "paid per paystack dashboard, delivered on techlink site" });
  assert.equal(r.code, 200, JSON.stringify(r.body)); const o = get("MD1");
  assert.equal(o.fulfilled, true); assert.equal(o.status, "success"); assert.equal(o.fulfillment_status, "fulfilled"); assert.ok(o.payment_verified_at); assert.equal(o.result.manualConfirmation, true); assert.equal(o.result.manualPaymentConfirmation, true);
  assert.equal(world.paystackCalls.length, 0, "no Paystack call"); assert.equal(world.techlinkCalls.length, 0, "no Techlink call");
  assert.equal(world.emails.length, 1, "customer told"); assert.equal(audit("admin_mark_delivered").length, 1); assert.equal(statusOf("MD1"), "Delivered");
});
await t("MANUAL: 'tell the customer' can be switched off", async () => { seed({ reference: "MD2", status: "payment_verified", fulfillment_status: "queued_with_provider" }); const r = await manual("ad", "admin", { reference: "MD2", action: "mark_delivered", note: "already told them on the phone", notifyCustomer: false }); assert.equal(r.code, 200); assert.equal(world.emails.length, 0); assert.equal(get("MD2").fulfilled, true); assert.ok(!get("MD2").result.manualPaymentConfirmation, "payment was already verified, so not flagged as a manual payment"); });
await t("MANUAL: operators and viewers are refused, and a note is mandatory", async () => {
  seed({ reference: "MD3", status: "pending" });
  for (const action of ["mark_delivered", "mark_resolved", "mark_paid_send"]) { assert.equal((await manual("op", "operator", { reference: "MD3", action, note: "operator trying" })).code, 403, action); assert.equal((await manual("vw", "viewer", { reference: "MD3", action, note: "viewer trying" })).code, 403); }
  assert.equal((await manual("ad", "admin", { reference: "MD3", action: "mark_delivered", note: "abc" })).code, 400); assert.equal(get("MD3").fulfilled, false); assert.equal(memdb.db.tables.audit_log.filter((a) => a.action.startsWith("admin_mark")).length, 0);
});
await t("MANUAL: mark_resolved on an UNPAID checkout closes it, hides it, and the customer sees 'Payment cancelled'", async () => {
  seed({ reference: "MR1", status: "pending" });
  const r = await manual("ad", "admin", { reference: "MR1", action: "mark_resolved", note: "customer never paid, confirmed by phone" }); assert.equal(r.code, 200);
  assert.equal(get("MR1").status, "payment_failed"); assert.equal(get("MR1").fail_reason, "payment_abandoned"); assert.equal(get("MR1").fulfilled, false); assert.equal(statusOf("MR1"), "Payment cancelled");
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.ok(!list.body.orders.some((x) => x.reference === "MR1"));
});
await t("MANUAL: mark_resolved on a PAID-but-undelivered order (refunded) removes it from Needs Attention AND from money-at-risk", async () => {
  seed({ reference: "MR2", status: "payment_verified", fulfillment_status: "manual_review", checkout_amount: 25 });
  const before = await call("pages/api/admin/overview.js", "vw", "viewer", { query: { range: "7d" } }); assert.equal(before.body.atRisk.count, 1);
  const r = await manual("ad", "admin", { reference: "MR2", action: "mark_resolved", note: "refunded the customer via paystack" }); assert.equal(r.code, 200);
  assert.equal(get("MR2").fulfillment_status, "resolved"); assert.equal(get("MR2").fulfilled, false); assert.equal(statusOf("MR2"), "Closed by support");
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.ok(!list.body.orders.some((x) => x.reference === "MR2"));
  const after = await call("pages/api/admin/overview.js", "vw", "viewer", { query: { range: "7d" } }); assert.equal(after.body.atRisk.count, 0, "no longer counted as money at risk");
  assert.equal(after.body.counts.delivered, 0, "not counted as a sale"); assert.equal(after.body.rates.fulfillment, null, "not counted as a failed delivery");
});
await t("MANUAL: mark_resolved on a charged-but-rejected order closes it", async () => {
  seed({ reference: "MR3" }); world.paystack.MR3 = { status: "success", amount: 100, currency: "GHS" }; await runWorkerCycle({}); assert.equal(get("MR3").fail_reason, "amount_mismatch");
  assert.equal((await manual("ad", "admin", { reference: "MR3", action: "mark_resolved", note: "refunded GHS 1.00 to customer" })).code, 200);
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.ok(!list.body.orders.some((x) => x.reference === "MR3"));
});
await t("MANUAL: mark_paid_send lets the admin confirm payment himself and sends it to Techlink (API used only for delivery)", async () => {
  seed({ reference: "MP1", status: "payment_failed", fail_reason: "amount_mismatch" });
  const r = await manual("ad", "admin", { reference: "MP1", action: "mark_paid_send", note: "paystack dashboard shows GHS 2.06 received" });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(get("MP1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1); assert.equal(world.paystackCalls.length, 0, "Paystack API was NOT needed"); assert.equal(audit("admin_mark_paid_send").length, 1);
});
await t("MANUAL: mark_paid_send will NOT deliver twice when Techlink already shows it, unless the admin forces it", async () => {
  seed({ reference: "MP2", status: "pending", payment_verified_at: null, created_at: minsAgo(30) }); world.techlinkOrders = [delivered()];
  const blocked = await manual("ad", "admin", { reference: "MP2", action: "mark_paid_send", note: "customer says no airtime" }); assert.equal(blocked.code, 409); assert.equal(blocked.body.canForce, true); assert.equal(world.techlinkCalls.length, 0); assert.equal(get("MP2").status, "pending");
  const forced = await manual("ad", "admin", { reference: "MP2", action: "mark_paid_send", note: "techlink support confirmed it failed", force: true }); assert.equal(forced.code, 200); assert.equal(world.techlinkCalls.length, 1); assert.ok(audit("admin_mark_paid_send")[0].note.includes("forced"));
});
await t("MANUAL: cannot override an order that is already delivered, or one being sent to Techlink this minute", async () => {
  seed({ reference: "DONE1", status: "success", fulfilled: true, fulfillment_status: "fulfilled" }); const a = await manual("ad", "admin", { reference: "DONE1", action: "mark_resolved", note: "trying to close a delivered order" }); assert.equal(a.code, 400); assert.ok(/already delivered/.test(a.body.error));
  seed({ reference: "BUSY1", status: "payment_verified", fulfillment_status: "processing", processing_started_at: new Date().toISOString() }); const b = await manual("ad", "admin", { reference: "BUSY1", action: "mark_delivered", note: "worker is mid-flight" }); assert.equal(b.code, 400); assert.ok(/right now/.test(b.body.error)); assert.equal(get("BUSY1").fulfilled, false);
});
await t("MANUAL: mark_paid_send refuses an order that is not waiting on payment", async () => { seed({ reference: "MP3", status: "payment_verified", fulfillment_status: "ready" }); const r = await manual("ad", "admin", { reference: "MP3", action: "mark_paid_send", note: "already paid, wrong button" }); assert.equal(r.code, 400); assert.equal(world.techlinkCalls.length, 0); });
await t("API CHECKS STILL WORK alongside manual control: Verify only records, Approve & deliver sends, process_now sends", async () => {
  seed({ reference: "API1", status: "pending" }); world.paystack.API1 = { status: "success", amount: 206, currency: "GHS" };
  assert.equal((await manual("op", "operator", { reference: "API1", action: "verify_and_process", note: "checking paystack" })).code, 200);
  assert.equal(get("API1").fulfilled, false, "Verify with Paystack must not deliver"); assert.equal(get("API1").fulfillment_status, "manual_review"); assert.equal(world.techlinkCalls.length, 0);
  const ap = await manual("ad", "admin", { reference: "API1", action: "approve_delivery", note: "checked in Paystack dashboard" }); assert.equal(ap.code, 200, JSON.stringify(ap.body));
  assert.equal(get("API1").fulfilled, true); assert.equal(world.techlinkCalls.length, 1); assert.equal(audit("admin_approve_delivery").length, 1);
  seed({ reference: "API2", status: "payment_verified", fulfillment_status: "ready" }); assert.equal((await manual("ad", "admin", { reference: "API2", action: "process_now", note: "push it now" })).code, 200); assert.equal(get("API2").fulfilled, true);
});
await t("AMOUNT UNITS: 'Customer paid' comes back in cedis, not pesewas (510 -> 5.10, 2237 -> 22.37)", async () => {
  seed({ reference: "UNIT1", status: "success", fulfilled: true, fulfillment_status: "fulfilled", payment_amount: 510, checkout_amount: 5.1 }); seed({ reference: "UNIT2", status: "payment_verified", fulfillment_status: "queued_with_provider", payment_amount: 2237, checkout_amount: 22.37 });
  const r = await call("pages/api/admin/orders.js", "vw", "viewer", { query: { filter: "all" } }); const by = Object.fromEntries(r.body.orders.map((o) => [o.reference, o]));
  assert.equal(by.UNIT1.paymentAmountGhs, 5.1); assert.equal(by.UNIT2.paymentAmountGhs, 22.37);
});
await t("CUSTOMER WORDING: a charged-but-rejected customer is never told 'Processing'", async () => { seed({ reference: "W1", status: "payment_failed", fail_reason: "amount_mismatch" }); seed({ reference: "W2", status: "payment_failed", fail_reason: "declined" }); assert.equal(statusOf("W1"), "Payment received — under review"); assert.equal(statusOf("W2"), "Payment failed"); });

console.error = quiet;
console.log(out.join("\n")); process.exit(out.some((x) => x.startsWith("FAIL")) ? 1 : 0);
