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

const pricing = read("lib/pricing.js");
if (!pricing.includes('tierbulkairtime')) {
  failures.push("lib/pricing.js: bulk Airtime must use the normalized zero-margin order type");
}
if (!pricing.includes("hasExplicitFixed") || !pricing.includes("hasExplicitFixed\n      ? 0")) {
  failures.push("lib/pricing.js: fixed-only markup must suppress the default percentage");
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
