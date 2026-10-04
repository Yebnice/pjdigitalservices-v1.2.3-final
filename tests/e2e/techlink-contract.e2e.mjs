// End-to-end: the Techlink contract (from the Techlink Business API V1 Postman document), the three "what happens to my order" questions,
// voucher delivery, test-mode guards, wallet-spend policy and alert volume.
// The fake Techlink below REJECTS any request that does not match the documented body shape.
// Run with: node --import ./tests/e2e/loader/register.mjs tests/e2e/techlink-contract.e2e.mjs
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

const FAKE_TL_LIVE = ["tlg", "live", "placeholder"].join("_");
const FAKE_TL_TEST = ["tlg", "test", "placeholder"].join("_");
process.env.BREVO_API_KEY = "brevo_test"; process.env.BREVO_SMS_SENDER = "PjDigital"; process.env.ADMIN_ALERT_EMAIL = "owner@example.com"; process.env.ADMIN_SMS_TO = "0240000000"; process.env.GEMINI_API_KEY = ["gem", "placeholder"].join("_");

const auth = await load("lib/adminAuth.js");
const { runWorkerCycle, runOutstandingCheck } = await load("lib/workerRun.js");
const store = await load("lib/store.js");
const { verifyAndFulfillOrder, fulfillClaimedOrder } = await load("lib/orderProcessing.js");
const { setDeliveryMode } = await load("lib/deliveryMode.js");

// ---------------------------------------------------------------- fake Techlink that enforces the Postman contract
const SPEC = {
  "POST /airtime": { keys: ["network", "phone", "amount"], enums: { network: ["MTN", "TELECEL", "AT"] } },
  "POST /data/purchase": { keys: ["network", "phone", "bundleId"], enums: { network: ["MTN", "TELECEL", "AT"] } },
  "POST /orders": { keys: ["name", "network", "phone", "size", "paymentMethod", "type", "callbackUrl"], enums: { paymentMethod: ["wallet"], type: ["single"] } },
  "POST /ecg": { keys: ["meter", "amount", "phone"] },
  "POST /water": { keys: ["meter", "amount", "phone"] },
  "POST /tv": { keys: ["service", "account", "amount"], enums: { service: ["DSTV", "GOTV", "STARTIMES"] } },
  "POST /result-checker/purchase": { keys: ["type", "quantity", "deliveryMethod"], enums: { type: ["BECE", "WASSCE"], deliveryMethod: ["email", "sms"] } },
  "POST /afa/register": { keys: ["fullName", "phone", "ghanaCard", "dob", "region", "location", "occupation", "paymentMethod"] },
};
const world = { emails: [], sms: [], paystack: {}, calls: [], violations: [], prompts: [], verifyStatus: "processing", techlinkMode: "normal", checkers: null, walletBalance: 500 };
const realJson = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const json = realJson;
  if (url.includes("api.paystack.co/transaction/verify/")) {
    const ref = decodeURIComponent(url.split("/verify/")[1]); const t0 = world.paystack[ref];
    return t0 ? json(200, { status: true, data: { reference: ref, ...t0 } }) : json(404, { status: false, message: "Transaction reference not found" });
  }
  if (url.includes("api.resend.com/emails")) { world.emails.push(JSON.parse(opts.body)); return json(200, { id: "em" }); }
  if (url.includes("brevo.com")) { world.sms.push(JSON.parse(opts.body)); return json(200, { messageId: "sms" }); }
  if (url.includes("generativelanguage.googleapis.com")) { world.prompts.push(String(opts.body)); return json(200, { candidates: [{ content: { parts: [{ text: "Hello!" }] } }] }); }
  if (url.includes("api.techlinkgh.com")) {
    const path = new URL(url).pathname.replace("/api/v1", ""); const method = (opts.method || "GET").toUpperCase();
    const key = String((opts.headers || {})["x-api-key"] || "");
    if (!key.startsWith("tlg_")) return json(401, { success: false, message: "Missing or invalid API key" });
    if (path === "/wallet/balance") return json(200, { success: true, balance: world.walletBalance });
    if (path === "/products/airtime-fee") return json(200, { percent: 2, rate: 0.02 });
    if (/^\/orders\?page=/.test(path + new URL(url).search)) return json(200, { rows: world.history || [] });
    let m;
    if ((m = path.match(/^\/orders\/([^/]+)\/verify$/)) && method === "POST") { world.calls.push({ path: "/orders/:id/verify", id: m[1] }); return json(200, { success: true, orderId: m[1], status: world.verifyStatus, changed: world.verifyStatus === "completed", message: "ok" }); }
    const spec = SPEC[`${method} ${path}`];
    if (!spec) return json(404, { success: false, message: `fake: not in the Postman document: ${method} ${path}` });
    const body = JSON.parse(opts.body || "{}"); const got = Object.keys(body).sort().join(","); const want = [...spec.keys].sort().join(",");
    if (got !== want) { world.violations.push(`${method} ${path}: sent {${got}} expected {${want}}`); return json(400, { success: false, message: "Validation failed" }); }
    for (const [f, allowed] of Object.entries(spec.enums || {})) if (!allowed.includes(body[f])) { world.violations.push(`${method} ${path}: ${f}=${JSON.stringify(body[f])} not in ${allowed}`); return json(400, { success: false, message: "Validation failed" }); }
    world.calls.push({ path, body });
    const orderId = "ORD-" + String(world.calls.length).padStart(8, "0");
    if (world.techlinkMode === "ambiguous") return json(503, { success: false, message: "upstream" });
    const base = { success: true, message: "ok", orderId, newBalance: 400, ...(world.techlinkMode === "testMode" ? { testMode: true } : {}) };
    if (path === "/orders") return json(201, { ...base, status: "processing" });
    if (path === "/result-checker/purchase") return json(201, { ...base, ...(world.techlinkMode === "noCheckers" ? {} : { checkers: world.checkers || [{ serialNumber: "0123456789", pin: "987654321012", type: "BECE" }] }) });
    return json(201, base);
  }
  return json(404, { message: "fake: unhandled " + url });
};

const toOf = (e) => [].concat(e.to).join(",");
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
let n = 0;
const seed = (over = {}) => { const ref = over.reference || `REF${++n}`; const row = { reference: ref, order_type: "airtime", network: "mtn", phone: "0241234567", email: "c@d.co", amount: 10, provider_cost: 10.2, checkout_amount: 10.3, paystack_fee_amount: 0.3, customer_product_amount: 10, business_markup_amount: 0, status: "pending", fulfilled: false, fulfillment_status: "pending", fulfillment_attempts: 0, created_at: minsAgo(3), ...over }; memdb.db.tables.orders.push(row); return row; };
const get = (ref) => memdb.db.tables.orders.find((o) => o.reference === ref);
const audit = (action) => memdb.db.tables.audit_log.filter((a) => a.action === action);
const cookieFor = (u, role) => { let c; auth.createAdminSession({ setHeader: (k, v) => { c = v; } }, { username: u, role }); return c.split(";")[0]; };
const mkRes = () => ({ code: null, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; return this; } });
const call = async (mod, user, role, { method = "GET", query = {}, body } = {}) => { const h = (await load(mod)).default; const res = mkRes(); await h({ method, query, body, headers: { cookie: user ? cookieFor(user, role) : "", host: "pjdigitalservices.online" } }, res); return res; };
const manual = (user, role, body) => call("pages/api/orders/manual-review.js", user, role, { method: "POST", body });
const live = (checkout, over = {}) => ({ status: "success", amount: Math.round(checkout * 100), currency: "GHS", domain: "live", id: 777, fees: 3, ...over });
const pay = (ref, checkout, over) => { world.paystack[ref] = live(checkout, over); };

const ENV0 = { NODE_ENV: process.env.NODE_ENV, K: process.env.PAYSTACK_SECRET_KEY, TK: process.env.TECHLINK_API_KEY, V: process.env.VERCEL_ENV };
const asProduction = ({ techlink = FAKE_TL_LIVE } = {}) => { process.env.NODE_ENV = "production"; process.env.PAYSTACK_SECRET_KEY = FAKE_LIVE; process.env.TECHLINK_API_KEY = techlink; delete process.env.VERCEL_ENV; };
const asTest = () => { process.env.NODE_ENV = ENV0.NODE_ENV; process.env.PAYSTACK_SECRET_KEY = ENV0.K; process.env.TECHLINK_API_KEY = ENV0.TK; delete process.env.WALLET_SPEND_ROLE; if (ENV0.V === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = ENV0.V; };
const fresh = () => { memdb.reset(); Object.assign(world, { emails: [], sms: [], paystack: {}, calls: [], violations: [], prompts: [], verifyStatus: "processing", techlinkMode: "normal", checkers: null, history: [] }); };
const out = []; const quiet = console.error; console.error = () => {}; console.warn = () => {};
const tt = async (name, fn) => { fresh(); try { await fn(); out.push("PASS " + name); } catch (e) { out.push("FAIL " + name + " -> " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); } finally { asTest(); memdb.db.failTable = null; } };
const noViolations = () => assert.deepEqual(world.violations, [], "the app sent a request that does not match the Postman document: " + world.violations.join(" ; "));

// ================================================================ A. CONTRACT: every request the app sends matches the Postman document
const CASES = [
  ["airtime", { order_type: "airtime", network: "mtn", amount: 10, checkout_amount: 10.3 }, "/airtime", { network: "MTN", phone: "0241234567", amount: 10 }],
  ["airtime (AirtelTigo maps to AT)", { order_type: "airtime", network: "airteltigo", amount: 10, checkout_amount: 10.3 }, "/airtime", { network: "AT", phone: "0241234567", amount: 10 }],
  ["data bundle", { order_type: "data", network: "telecel", amount: 5.5, checkout_amount: 5.7, bundle_id: "RACT_Data_Flexi_Bundle_1" }, "/data/purchase", { network: "TELECEL", phone: "0241234567", bundleId: "RACT_Data_Flexi_Bundle_1" }],
  ["MTN Express (agent product)", { order_type: "tierData", network: "mtn", amount: 4.7, checkout_amount: 4.9, tier_details: { tierKey: "mtnExpress", name: "MTN 1GB", size: 1 } }, "/orders", { name: "MTN 1GB", network: "MTN", phone: "0241234567", size: 1, paymentMethod: "wallet", type: "single", callbackUrl: "" }],
  ["ECG electricity", { order_type: "ecg", network: "ecg", amount: 50, checkout_amount: 51, meter_number: "0210444711" }, "/ecg", { meter: "0210444711", amount: 50, phone: "0241234567" }],
  ["Ghana Water", { order_type: "water", network: "water", amount: 50, checkout_amount: 51, meter_number: "0500123456" }, "/water", { meter: "0500123456", amount: 50, phone: "0241234567" }],
  ["TV subscription", { order_type: "tv", network: "tv", amount: 50, checkout_amount: 51, meter_number: "7020000004", tv_details: { service: "DSTV" } }, "/tv", { service: "DSTV", account: "7020000004", amount: 50 }],
  ["result checker voucher", { order_type: "checker", network: "waec", amount: 20, checkout_amount: 20.6, checker_details: { mode: "voucher", type: "BECE", quantity: 1, deliveryMethod: "email" } }, "/result-checker/purchase", { type: "BECE", quantity: 1, deliveryMethod: "email" }],
];
for (const [label, over, path, expectBody] of CASES) {
  await tt(`CONTRACT: ${label} sends exactly the documented request (${path}) and is delivered`, async () => {
    seed({ reference: "K1", ...over }); pay("K1", over.checkout_amount);
    await verifyAndFulfillOrder("K1"); noViolations();
    assert.equal(world.calls.length, 1, "exactly one Techlink purchase"); assert.equal(world.calls[0].path, path); assert.deepEqual(world.calls[0].body, expectBody);
    assert.equal(get("K1").fulfilled, true, `status ${get("K1").status}/${get("K1").fulfillment_status}`);
  });
}

await tt("CONTRACT: AFA registration sends the documented body keys (the Postman curl example uses different aliases: UNVERIFIED which Techlink really accepts)", async () => {
  process.env.AFA_ENCRYPTION_KEY = "k".repeat(48);
  const o = await store.createOrder({ reference: "KAFA", orderType: "afa", network: "mtn", phone: "0241234567", email: "c@d.co", amount: 15, checkoutAmount: 15.5, afaDetails: { fullName: "Kofi Mensah", ghanaCard: "GHA-123456789-0", dob: "1995-04-12", region: "Greater Accra", location: "East Legon", occupation: "Trader" } });
  memdb.db.tables.orders.find((r) => r.reference === "KAFA").created_at = minsAgo(2); pay("KAFA", 15.5);
  await verifyAndFulfillOrder("KAFA"); noViolations(); assert.equal(world.calls[0].path, "/afa/register"); assert.equal(get("KAFA").fulfilled, true);
});

// ================================================================ B. YOUR THREE QUESTIONS, AS EXECUTABLE ANSWERS
await tt("Q1: a customer PAYS for airtime (live, fresh, automatic mode) -> NOT held: delivered at once, receipt + email go out", async () => {
  asProduction(); seed({ reference: "Q1A", amount: 10, checkout_amount: 10.3 }); pay("Q1A", 10.3);
  const r = await verifyAndFulfillOrder("Q1A"); assert.equal(get("Q1A").fulfilled, true, JSON.stringify(r).slice(0, 120)); assert.equal(world.calls.length, 1);
  assert.ok(world.emails.some((e) => toOf(e) === "c@d.co" && /Delivered/.test(e.subject)));
});

await tt("Q1: the SAME paid airtime order IS held in each of these four situations (and the reason is recorded)", async () => {
  asProduction();
  seed({ reference: "Q1M", amount: 10, checkout_amount: 10.3 }); pay("Q1M", 10.3); await setDeliveryMode("manual", "ad"); await verifyAndFulfillOrder("Q1M"); await setDeliveryMode("automatic", "ad");
  assert.equal(get("Q1M").fulfillment_status, "manual_review"); assert.match(get("Q1M").last_fulfillment_error, /MANUAL/);
  seed({ reference: "Q1L", amount: 10, checkout_amount: 10.3, created_at: minsAgo(120) }); pay("Q1L", 10.3); await verifyAndFulfillOrder("Q1L");
  assert.equal(get("Q1L").fulfillment_status, "manual_review"); assert.match(get("Q1L").last_fulfillment_error, /minutes old/);
  seed({ reference: "Q1C", amount: 10, checkout_amount: 10.3, created_at: minsAgo(500) }); pay("Q1C", 10.3); await runOutstandingCheck();
  assert.equal(get("Q1C").fulfillment_status, "manual_review"); assert.match(get("Q1C").last_fulfillment_error, /outstanding-orders check/);
  seed({ reference: "Q1T", amount: 10, checkout_amount: 10.3 }); pay("Q1T", 10.3, { domain: "test" }); await verifyAndFulfillOrder("Q1T");
  assert.equal(get("Q1T").status, "payment_failed"); assert.equal(get("Q1T").fail_reason, "test_mode_payment");
  assert.equal(world.calls.length, 0, "none of the four reached Techlink");
});

await tt("Q2: MTN MASTER (slow tier): paid -> accepted by Techlink -> QUEUED (not 'delivered', not held) -> customer told 'queued' -> confirmed later by Techlink's verify endpoint", async () => {
  asProduction(); seed({ reference: "Q2M", order_type: "tierData", amount: 4.4, checkout_amount: 4.6, tier_details: { tierKey: "mtnMaster", name: "MTN 1GB", size: 1 }, order_no: "PJ-MSTR2345" }); pay("Q2M", 4.6);
  await verifyAndFulfillOrder("Q2M"); noViolations();
  assert.equal(get("Q2M").fulfillment_status, "queued_with_provider"); assert.equal(get("Q2M").fulfilled, false); assert.equal(world.calls.length, 1);
  const queuedMail = world.emails.find((e) => toOf(e) === "c@d.co"); assert.ok(queuedMail && /queued/i.test(queuedMail.subject) && queuedMail.subject.includes("PJ-MSTR2345"), queuedMail?.subject);
  assert.ok(!world.emails.some((e) => /Delivered/.test(e.subject)), "must NOT claim delivered while Techlink is still processing");
  world.verifyStatus = "processing"; await runWorkerCycle({ batchSize: 5, sweepLimit: 5 }); assert.equal(get("Q2M").fulfillment_status, "queued_with_provider", "still processing at Techlink: stays queued");
  assert.equal(world.calls.filter((c) => c.path === "/orders").length, 1, "never re-sent to Techlink while queued");
  world.verifyStatus = "completed"; await runWorkerCycle({ batchSize: 5, sweepLimit: 5 });
  assert.equal(get("Q2M").fulfilled, true); assert.ok(world.emails.some((e) => /Delivered/.test(e.subject)), "customer told delivered only now"); assert.equal(world.calls.filter((c) => c.path === "/orders").length, 1);
});

await tt("Q2: MTN Master in MANUAL mode is held BEFORE it is sent; once an admin approves it, it is sent once and then queued like any other", async () => {
  asProduction(); await setDeliveryMode("manual", "ad");
  seed({ reference: "Q2N", order_type: "tierData", amount: 4.4, checkout_amount: 4.6, tier_details: { tierKey: "mtnMaster", name: "MTN 1GB", size: 1 } }); pay("Q2N", 4.6);
  await verifyAndFulfillOrder("Q2N"); assert.equal(world.calls.length, 0); assert.equal(get("Q2N").fulfillment_status, "manual_review");
  const r = await manual("ad", "admin", { reference: "Q2N", action: "approve_delivery", note: "approved after checking Paystack" }); assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(world.calls.length, 1); assert.equal(get("Q2N").fulfillment_status, "queued_with_provider");
});

await tt("Q3: THREE uncompleted checkouts (abandoned / actually paid / never opened): 'Check outstanding orders' delivers NOTHING and sorts them correctly", async () => {
  seed({ reference: "U1", created_at: minsAgo(200) }); world.paystack.U1 = { status: "abandoned", amount: 1030, currency: "GHS", domain: "live" };
  seed({ reference: "U2", created_at: minsAgo(200) }); pay("U2", 10.3);
  seed({ reference: "U3", created_at: minsAgo(200) });
  const r = await call("pages/api/admin/run-worker.js", "op", "operator", { method: "POST" });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.deliveries, 0); assert.equal(world.calls.length, 0);
  assert.equal(get("U1").fail_reason, "payment_abandoned", "abandoned at Paystack -> closed: " + JSON.stringify({ s: get("U1").status, f: get("U1").fail_reason }));
  assert.equal(get("U2").fulfillment_status, "manual_review", "paid -> waits for approval"); assert.equal(get("U2").fail_reason, "held_for_approval");
  assert.equal(get("U3").fail_reason, "payment_abandoned", "Paystack never saw it -> closed after the grace period");
  const list = await call("pages/api/orders/manual-review.js", "op", "operator"); assert.deepEqual(list.body.orders.filter((o) => o.category === "held").map((o) => o.reference), ["U2"]);
  const refused = await manual("op", "operator", { reference: "U2", action: "approve_delivery", note: "x" }); assert.equal(refused.code, 403, "default policy: only an admin spends wallet money");
  const ok = await manual("ad", "admin", { reference: "U2", action: "approve_delivery", note: "customer shared MoMo receipt" }); assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(world.calls.length, 1); assert.equal(get("U2").fulfilled, true);
});

// ================================================================ C. VOUCHERS: the customer must actually RECEIVE the serial and PIN
const voucherOrder = (over = {}) => seed({ reference: "V1", order_type: "checker", network: "waec", amount: 20, checkout_amount: 20.6, order_no: "PJ-VCHR2345", checker_details: { mode: "voucher", type: "BECE", quantity: 1, deliveryMethod: "email" }, ...over });

await tt("VOUCHER: the delivered voucher (serial + PIN) is visible to its OWNER in the customer API", async () => {
  voucherOrder(); pay("V1", 20.6); await verifyAndFulfillOrder("V1");
  const pub = store.toPublicOrderForViewer(await store.getOrder("V1"), "c@d.co");
  assert.deepEqual(pub.result.checkers, [{ type: "BECE", serialNumber: "0123456789", pin: "987654321012" }]);
});
await tt("VOUCHER: someone who is NOT the owner never sees it", async () => {
  voucherOrder(); pay("V1", 20.6); await verifyAndFulfillOrder("V1");
  const pub = store.toPublicOrderForViewer(await store.getOrder("V1"), "stranger@x.com"); assert.equal(pub.result, null);
});
await tt("VOUCHER: the customer is EMAILED the serial and PIN with the order number (they chose 'Email')", async () => {
  voucherOrder(); pay("V1", 20.6); await verifyAndFulfillOrder("V1");
  const mail = world.emails.find((e) => toOf(e) === "c@d.co" && /voucher|checker/i.test(e.subject + e.text) && e.text.includes("987654321012"));
  assert.ok(mail, "no email to the customer contained the PIN: " + JSON.stringify(world.emails.map((e) => e.subject))); assert.ok(mail.text.includes("0123456789") && mail.text.includes("PJ-VCHR2345"), mail.text);
});
await tt("VOUCHER: if the customer chose SMS, the serial and PIN are texted to the phone they gave (and fit one message)", async () => {
  voucherOrder({ phone: "0551864239", checker_details: { mode: "voucher", type: "BECE", quantity: 1, deliveryMethod: "sms" } }); pay("V1", 20.6); await verifyAndFulfillOrder("V1");
  const s = world.sms.find((m) => String(m.recipient || m.to || "").includes("551864239") && String(m.content).includes("987654321012")); assert.ok(s, JSON.stringify(world.sms)); assert.ok(s.content.length <= 160, s.content.length + ": " + s.content);
});
await tt("VOUCHER: Techlink says 'success' but returns NO voucher details -> NOT marked delivered; held for a human with the reason", async () => {
  world.techlinkMode = "noCheckers"; voucherOrder(); pay("V1", 20.6); await verifyAndFulfillOrder("V1");
  assert.equal(get("V1").fulfilled, false); assert.equal(get("V1").fulfillment_status, "manual_review"); assert.match(get("V1").last_fulfillment_error, /voucher/i);
  assert.ok(!world.emails.some((e) => /Delivered/.test(e.subject)), "must not tell the customer it was delivered");
});
await tt("VOUCHER: Techlink returns FEWER vouchers than were bought -> held, not delivered", async () => {
  voucherOrder({ checker_details: { mode: "voucher", type: "BECE", quantity: 3, deliveryMethod: "email" }, amount: 60, checkout_amount: 61.5 }); pay("V1", 61.5); await verifyAndFulfillOrder("V1");
  assert.equal(get("V1").fulfilled, false); assert.equal(get("V1").fulfillment_status, "manual_review");
});

// ================================================================ D. PRIVACY: nothing sensitive goes to the AI provider
await tt("PRIVACY: the AI chat prompt never contains an electricity token or a voucher PIN", async () => {
  seed({ reference: "TKN1", order_type: "ecg", network: "ecg", amount: 50, checkout_amount: 51, meter_number: "0210444711", status: "success", fulfilled: true, fulfillment_status: "fulfilled", result: { token: "1234-5678-9012-3456", units: 12.5, orderId: "ORD-1" } });
  voucherOrder({ status: "success", fulfilled: true, fulfillment_status: "fulfilled", result: { orderId: "ORD-2", checkers: [{ serialNumber: "0123456789", pin: "987654321012", type: "BECE" }] } });
  for (const ref of ["TKN1", "V1"]) {
    const r = await call("pages/api/ai/chat.js", null, null, { method: "POST", body: { messages: [{ role: "user", content: "hello, what can you do?" }], orderReference: ref, orderEmail: "c@d.co" } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
  }
  assert.ok(world.prompts.length >= 2, "the AI must actually have been called for this test to mean anything (" + world.prompts.length + ")");
  const all = world.prompts.join("\n"); assert.ok(!all.includes("1234-5678-9012-3456") && !all.includes("987654321012") && !all.includes("0123456789"), "a secret reached the AI provider");
});

// ================================================================ E. TEST-MODE GUARDS: a test key can never "deliver" to real customers
await tt("GUARD: a Techlink TEST key in production sends NOTHING and leaves the order ready (so it delivers once the key is fixed)", async () => {
  asProduction({ techlink: FAKE_TL_TEST }); seed({ reference: "TK1", amount: 10, checkout_amount: 10.3 }); pay("TK1", 10.3);
  await verifyAndFulfillOrder("TK1"); assert.equal(world.calls.length, 0); assert.equal(get("TK1").fulfilled, false); assert.equal(get("TK1").fulfillment_status, "ready", "not parked, not lost");
  process.env.TECHLINK_API_KEY = FAKE_TL_LIVE; await runWorkerCycle({ batchSize: 5, sweepLimit: 5 }); assert.equal(get("TK1").fulfilled, true, "delivers on the next cycle once a live key is set");
});
await tt("GUARD: a response that says testMode:true is never treated as delivered in production", async () => {
  asProduction(); world.techlinkMode = "testMode"; seed({ reference: "TM1", amount: 10, checkout_amount: 10.3 }); pay("TM1", 10.3);
  await verifyAndFulfillOrder("TM1"); assert.equal(get("TM1").fulfilled, false); assert.equal(get("TM1").fulfillment_status, "manual_review"); assert.match(get("TM1").last_fulfillment_error, /test mode/i);
  assert.ok(!world.emails.some((e) => /Delivered/.test(e.subject)));
});
await tt("GUARD: the health endpoint reports the Techlink key mode so the dashboard can warn", async () => {
  asProduction({ techlink: FAKE_TL_TEST }); const h = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(h.code, 200); assert.equal(h.body.techlink.keyMode, "test");
  process.env.TECHLINK_API_KEY = FAKE_TL_LIVE; const h2 = await call("pages/api/admin/health.js", "op", "operator"); assert.equal(h2.body.techlink.keyMode, "live");
});

// ================================================================ F. WALLET-SPEND POLICY: who may spend money
await tt("POLICY: by default only an ADMIN can approve, send now, or authorise a retry; operators can still check and verify", async () => {
  seed({ reference: "P1", status: "payment_verified", fulfillment_status: "manual_review", fail_reason: "held_for_approval", payment_verified_at: minsAgo(5), payment_amount: 1030, manual_review_at: minsAgo(5) }); pay("P1", 10.3);
  seed({ reference: "P2", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(1), payment_amount: 1030 });
  seed({ reference: "P3", status: "payment_verified", fulfillment_status: "manual_review", fail_reason: "fulfillment_failed", payment_verified_at: minsAgo(5), payment_amount: 1030, manual_review_at: minsAgo(5) });
  for (const [ref, action] of [["P1", "approve_delivery"], ["P2", "process_now"], ["P3", "retry"]]) {
    const r = await manual("op", "operator", { reference: ref, action, note: "trying as operator" }); assert.equal(r.code, 403, `${action} must be admin-only by default, got ${r.code}`);
  }
  assert.equal(world.calls.length, 0);
  assert.equal((await manual("op", "operator", { reference: "P1", action: "recheck", note: "just looking" })).code !== 403, true, "non-spending checks stay open to operators");
  assert.equal((await manual("ad", "admin", { reference: "P2", action: "process_now", note: "ok" })).code, 200); assert.equal(get("P2").fulfilled, true);
});
await tt("POLICY: WALLET_SPEND_ROLE=operator deliberately relaxes it", async () => {
  process.env.WALLET_SPEND_ROLE = "operator"; seed({ reference: "P4", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(1), payment_amount: 1030 });
  assert.equal((await manual("op", "operator", { reference: "P4", action: "process_now", note: "ok" })).code, 200);
});

await tt("POLICY: even when operators may spend, they still cannot FORCE a retry against Techlink's evidence (admin only)", async () => {
  process.env.WALLET_SPEND_ROLE = "operator"; seed({ reference: "P5", status: "payment_verified", fulfillment_status: "failed", payment_verified_at: minsAgo(5), payment_amount: 1030, manual_review_at: minsAgo(5) });
  world.history = [{ orderId: "ORD-DONE1", productType: "Airtime", phoneNumber: "0241234567", amount: 10.2, costPrice: 10, status: "completed", createdAt: minsAgo(2) }]; // after the payment was verified, so it can be THIS order
  const r = await manual("op", "operator", { reference: "P5", action: "retry", note: "forcing", force: true });
  assert.equal(r.code, 409, "Techlink already shows it delivered, and an operator may not force it. got " + r.code + " " + JSON.stringify(r.body).slice(0, 120));
  assert.equal(world.calls.length, 0);
  const adm = await manual("ad", "admin", { reference: "P5", action: "retry", note: "verified it never arrived", force: true }); assert.equal(adm.code, 200, JSON.stringify(adm.body)); assert.equal(world.calls.length, 1);
});

// ================================================================ H. SECOND TRIGGER: Vercel Cron calls the same endpoint with GET + a bearer token
const cronCall = async (authorization) => { const h = (await load("pages/api/jobs/fulfill.js")).default; const res = mkRes(); await h({ method: "GET", query: {}, headers: { authorization, host: "pjdigitalservices.online" } }, res); return res; };
await tt("CRON: a Vercel-style GET with 'Authorization: Bearer <CRON_SECRET>' runs the worker and delivers a fresh paid order", async () => {
  process.env.CRON_SECRET = "cron-secret-for-test-0123456789";
  seed({ reference: "CR1", status: "payment_verified", fulfillment_status: "ready", payment_verified_at: minsAgo(2), payment_amount: 1030 });
  const bad = await cronCall("Bearer wrong"); assert.equal(bad.code, 401); assert.equal(world.calls.length, 0);
  const none = await cronCall(undefined); assert.equal(none.code, 401);
  const ok = await cronCall("Bearer cron-secret-for-test-0123456789"); assert.equal(ok.code, 200, JSON.stringify(ok.body)); assert.equal(get("CR1").fulfilled, true);
  delete process.env.CRON_SECRET;
});
await tt("CRON: the same call never delivers an old checkout nobody approved (the incident cannot recur through the second trigger)", async () => {
  process.env.CRON_SECRET = "cron-secret-for-test-0123456789"; asProduction();
  seed({ reference: "CR2", created_at: minsAgo(600) }); pay("CR2", 10.3);
  const ok = await cronCall("Bearer cron-secret-for-test-0123456789"); assert.equal(ok.code, 200);
  assert.equal(world.calls.length, 0); assert.equal(get("CR2").fulfillment_status, "manual_review"); assert.equal(get("CR2").fail_reason, "held_for_approval");
  delete process.env.CRON_SECRET;
});

// ================================================================ G. ALERT VOLUME: held orders are a queue, not an incident
await tt("ALERTS: 6 held orders produce ONE admin digest email and at most ONE admin SMS (not 12 emails + 6 SMS), and each email says WHY", async () => {
  for (let i = 1; i <= 6; i += 1) seed({ reference: `H${i}`, order_no: `PJ-HELD${i}234`, manual_review_notified_at: null, urgent_review_notified_at: null, customer_delay_notified_at: null,  status: "payment_verified", fulfillment_status: "manual_review", fail_reason: "held_for_approval", last_fulfillment_error: "Delivery mode is MANUAL, so every paid order waits for an admin to approve it.", payment_verified_at: minsAgo(400), payment_amount: 1030, manual_review_at: minsAgo(400), created_at: minsAgo(405) });
  await runWorkerCycle({ batchSize: 5, sweepLimit: 5 });
  const toAdmin = world.emails.filter((e) => toOf(e) === "owner@example.com"); assert.equal(toAdmin.length, 1, "admin emails: " + toAdmin.length + " " + JSON.stringify(toAdmin.map((e) => e.subject)));
  assert.ok(/6 paid order/.test(toAdmin[0].subject) && toAdmin[0].text.includes("PJ-HELD1234") && /MANUAL/.test(toAdmin[0].text), toAdmin[0].subject + "\n" + toAdmin[0].text);
  const adminSms = world.sms.filter((m) => String(m.recipient || m.to).includes("240000000")); assert.ok(adminSms.length <= 1, "admin SMS: " + adminSms.length);
  assert.equal(world.emails.filter((e) => toOf(e) === "c@d.co").length, 6, "each waiting customer still gets their own honest notice");
  await runWorkerCycle({ batchSize: 5, sweepLimit: 5 }); assert.equal(world.emails.filter((e) => toOf(e) === "owner@example.com").length, 1, "a second cycle must not repeat the digest");
});
await tt("ALERTS: a genuine INCIDENT (an ambiguous Techlink failure) still alerts the admin per order, with the incident wording", async () => {
  seed({ reference: "INC1", manual_review_notified_at: null, urgent_review_notified_at: null, customer_delay_notified_at: null, status: "payment_verified", fulfillment_status: "manual_review", fail_reason: "fulfillment_ambiguous", last_fulfillment_error: "Techlink timed out", payment_verified_at: minsAgo(40), payment_amount: 1030, manual_review_at: minsAgo(40) });
  await runWorkerCycle({ batchSize: 5, sweepLimit: 5 });
  const toAdmin = world.emails.filter((e) => toOf(e) === "owner@example.com"); assert.ok(toAdmin.some((e) => /INC1/.test(e.subject)), JSON.stringify(toAdmin.map((e) => e.subject)));
});

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
