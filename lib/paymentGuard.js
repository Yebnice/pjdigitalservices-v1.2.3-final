// Is this Paystack transaction REAL, LIVE money for THIS order?
//
// Why this exists: every delivery spends real Techlink wallet money. Before this
// guard, "status === success" from Paystack was the only proof of payment. A
// Paystack TEST-mode "success" (no money moves) is indistinguishable from a live
// one unless the response's `domain` is checked, so a test key (or a test
// checkout) in production could deliver goods that nobody paid for.
//
// Pure functions only: no database, no network.

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === "production" && !["preview", "development"].includes(String(env.VERCEL_ENV || ""));
}

export function allowTestPayments(env = process.env) {
  return String(env.ALLOW_PAYSTACK_TEST_PAYMENTS || "").trim().toLowerCase() === "true";
}

export function secretKeyMode(env = process.env) {
  const key = String(env.PAYSTACK_SECRET_KEY || "");
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return "unknown";
}

// Strict = production runtime without the explicit test-payments override.
export function isStrict(env = process.env) {
  return isProductionRuntime(env) && !allowTestPayments(env);
}

// Codes that mean "this was not a real payment for this order". They must NEVER
// be treated as "the customer was charged but rejected": no money moved.
export const NOT_REAL_PAYMENT_CODES = ["test_key_in_production", "test_mode_payment", "reference_mismatch"];

const TEXT = {
  test_key_in_production: "PAYSTACK_SECRET_KEY is a TEST key (sk_test_…) but this is the production site. Test payments move no money, so nothing is delivered. Set the live key, or set ALLOW_PAYSTACK_TEST_PAYMENTS=true only on a staging copy.",
  test_mode_payment: "Paystack reports this transaction as a TEST-mode payment (domain \"test\"). No real money moved, so nothing was delivered.",
  reference_mismatch: "Paystack returned a different transaction reference than the order's. Nothing was delivered.",
};

// Returns { ok: true } or { ok: false, code, detail }. Checks only what proves
// the payment is genuine; amount and currency stay with the caller, which
// records them as "charged but rejected" because there real money DID move.
export function assessPaystackPayment({ txn, reference, env = process.env } = {}) {
  if (!txn || typeof txn !== "object") return { ok: false, code: "no_transaction", detail: "Paystack returned no transaction data." };
  const strict = isStrict(env);

  if (strict && secretKeyMode(env) === "test") {
    return { ok: false, code: "test_key_in_production", detail: TEXT.test_key_in_production };
  }

  const gotRef = txn.reference == null ? "" : String(txn.reference);
  if (gotRef ? gotRef !== String(reference) : strict) {
    return { ok: false, code: "reference_mismatch", detail: TEXT.reference_mismatch };
  }

  // Production: only a transaction Paystack itself labels "live" counts. A
  // missing domain fails closed. Outside production (local dev, tests, previews)
  // test payments are allowed so the app can still be developed.
  if (strict && String(txn.domain || "").toLowerCase() !== "live") {
    return { ok: false, code: "test_mode_payment", detail: TEXT.test_mode_payment };
  }
  return { ok: true };
}
