const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const failures = [];

const apiRoot = path.join(process.cwd(), "pages", "api");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      const text = fs.readFileSync(full, "utf8");
      if (/\bconst\s+rl\s*=\s*rateLimit\s*\(/.test(text)) {
        failures.push(`${path.relative(process.cwd(), full)}: rateLimit must be awaited`);
      }
    }
  }
}
walk(apiRoot);


const workerWorkflow = path.join(process.cwd(), ".github", "workflows", "background-worker.yml");
const legacyWorkerWorkflow = path.join(process.cwd(), "workflows", "background-worker.yml");
if (!fs.existsSync(workerWorkflow)) {
  failures.push("GitHub Actions: background-worker.yml must live in .github/workflows so GitHub can discover it");
}
if (fs.existsSync(legacyWorkerWorkflow)) {
  failures.push("GitHub Actions: legacy root workflows/background-worker.yml must not remain");
}

const pricing = read("lib/pricing.js");

// The business-margin matrix is intentionally hard-coded. Deployment environment
// variables must not be able to change the owner's pricing policy.
if (!pricing.includes("export const DEFAULT_BUSINESS_MARGIN_PERCENT = 2;")) {
  failures.push("lib/pricing.js: business margin constant must be exactly 2%");
}
if (!pricing.includes('const NO_MARGIN_ORDER_TYPES = new Set(["airtime", "data", "tierbulkairtime"]);')) {
  failures.push("lib/pricing.js: zero-margin order-type matrix is missing or changed");
}
if (!pricing.includes("return hasNoBusinessMargin(orderType) ? 0 : roundMoney(base * 0.02);")) {
  failures.push("lib/pricing.js: businessMarkup must enforce 0% or exactly 2% according to the locked matrix");
}
if (
  pricing.includes('envNumber("DEFAULT_BUSINESS_MARGIN_PERCENT"') ||
  pricing.includes("SERVICE_MARKUP_RULES_JSON") ||
  pricing.includes("hasExplicitFixed")
) {
  failures.push("lib/pricing.js: configurable business-margin overrides must not remain");
}
if (!pricing.includes('envNumber("PAYSTACK_FEE_RATE", 0.0195)')) {
  failures.push("lib/pricing.js: Paystack Ghana fee default must remain 1.95%");
}
if (!pricing.includes("export function getPaystackPaymentAmount(")) {
  failures.push("lib/pricing.js: shared Paystack payment-amount resolver is missing");
}
if (!pricing.includes("const paymentAmount = getPaystackPaymentAmount(")) {
  failures.push("lib/pricing.js: checkout must use the shared Paystack payment-amount resolver");
}
if (!pricing.includes("return checkout || product || fallback;")) {
  failures.push("lib/pricing.js: Ghana checkout must send the single fee-inclusive amount to Paystack");
}

const ui = read("components/ui.js");
if (!ui.includes("const customerOrderNumber = order.orderNo || null")) {
  failures.push("components/ui.js: purchase receipt must use the customer-facing order number");
}
if (ui.includes("order.orderNo || order.reference")) {
  failures.push("components/ui.js: purchase receipt must never fall back to the Paystack reference as the customer order number");
}
if (!ui.includes("Back to home")) {
  failures.push("components/ui.js: purchase receipt must provide a Back to home action");
}
if (!ui.includes('label="Order number"') || !ui.includes("customerOrderNumber || \"Unavailable — contact support\"")) {
  failures.push("components/ui.js: receipt must render a safe customer order-number value");
}

const orderTrack = read("pages/api/orders/track.js");
if (!orderTrack.includes('req.method !== "POST"') || orderTrack.includes("req.query.reference") || orderTrack.includes("req.query.email")) {
  failures.push("pages/api/orders/track.js: customer credentials must use POST body");
}

const feedbackTrack = read("pages/api/feedback/track.js");
if (!feedbackTrack.includes('req.method !== "POST"') || feedbackTrack.includes("req.query.email") || feedbackTrack.includes("req.query.caseReference")) {
  failures.push("pages/api/feedback/track.js: customer credentials must use POST body");
}

const store = read("lib/store.js");
if (!store.includes('fulfillment_status: "not_applicable"')) {
  failures.push("lib/store.js: terminal payment failures must not remain in fulfillment_status=pending");
}
if (!store.includes('[\"pending\", \"not_applicable\", \"failed\", \"ready\"]')) {
  failures.push("lib/store.js: a genuinely paid late recovery must still accept terminal payment rows");
}
if (!store.includes("payment_rejected_after_charge")) {
  failures.push("lib/store.js: charged-but-rejected payments need a distinct terminal payment state");
}
const supabaseSchema = read("supabase/schema.sql");
if (!supabaseSchema.includes("new.fulfillment_status = 'fulfilled'") || !supabaseSchema.includes("new.status is distinct from 'success'")) {
  failures.push("supabase/schema.sql: completed orders must allow status=success when payment_verified_at is present");
}

const processing = read("lib/orderProcessing.js");
if (!processing.includes('String(txn.currency || "").toUpperCase() !== "GHS"')) {
  failures.push("lib/orderProcessing.js: payment currency must be explicitly GHS, including missing currency");
}
if (!processing.includes("markPaymentRejectedAfterCharge")) {
  failures.push("lib/orderProcessing.js: successful charged mismatches must be recorded separately from failed payments");
}

if (!store.includes('encryptAfaDetails(order.afaDetails)') || !store.includes('decryptAfaDetails(row.afa_details)')) {
  failures.push("lib/store.js: AFA data must be encrypted/decrypted centrally");
}

const afaSecurity = read("lib/afaSecurity.js");
if (!afaSecurity.includes("aes-256-gcm") || !afaSecurity.includes("AFA_ENCRYPTION_KEY")) {
  failures.push("lib/afaSecurity.js: AFA encryption contract missing");
}

const nextConfig = read("next.config.js");
if (!nextConfig.includes('process.env.NODE_ENV === "production"') || !nextConfig.includes('"Content-Security-Policy"')) {
  failures.push("next.config.js: production CSP enforcement contract missing");
}

for (const file of ["pages/data.js","pages/airtime.js","pages/tv.js","pages/afa.js","pages/checker.js","pages/bills.js","components/TierShop.js"]) {
  const text = read(file);
  if (text.includes('window.localStorage.getItem("pj_email")') || text.includes('window.localStorage.setItem("pj_email"')) {
    failures.push(`${file}: customer email should use sessionStorage`);
  }
}


const bills = read("pages/bills.js");
if (!bills.includes("/api/techlink/ecg-lookup?")) {
  failures.push("pages/bills.js: ECG lookup route wiring missing");
}
if (!bills.includes('phone,') || !bills.includes("setEcgLookup(null)") || !bills.includes("ecgLookupResolved")) {
  failures.push("pages/bills.js: ECG phone-aware validation/reset contract missing");
}
if (!bills.includes("/api/techlink/water-validate") || !bills.includes('account: meterNumber, phone')) {
  failures.push("pages/bills.js: Water validation must pass account and phone");
}
if (!bills.includes("waterResolved")) {
  failures.push("pages/bills.js: Water payment must require a successful validation state");
}

const tierShop = read("components/TierShop.js");
if (!tierShop.includes("NetworkMismatchNotice") ||
    !tierShop.includes("(!networkMismatch || networkConfirmed)") ||
    !tierShop.includes("hasNetworkMismatches(rows, networkId)")) {
  failures.push("components/TierShop.js: network mismatch protection must cover dedicated data purchase modes");
}
if (!tierShop.includes("const mismatches = hasNetworkMismatches(rows, networkId)")) {
  failures.push("components/TierShop.js: bulk/Excel network mismatch detection missing");
}

const webhookQueue = read("lib/paystackWebhookQueue.js");
if (webhookQueue.includes("available_at: terminal")) {
  failures.push("lib/paystackWebhookQueue.js: retry scheduling references undefined terminal state");
}
if (!webhookQueue.includes("Date.now() + delayMinutes * 60_000")) {
  failures.push("lib/paystackWebhookQueue.js: retry delay calculation is missing");
}

if (failures.length) {
  console.error("Production contract check failed:");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("Production contract check passed.");
