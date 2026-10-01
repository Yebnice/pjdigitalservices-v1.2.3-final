// Server-side only — holds TECHLINK_API_KEY.
//
// This is wired to the REAL Techlink Business API v1, based on the PDF
// documentation and Postman docs you shared. It will work as soon as you
// set TECHLINK_API_KEY in your environment to a real key (tlg_test_...
// while testing, tlg_live_... once you're ready for real orders).
//
// One small thing worth a live test call before you rely on it: water and
// TV both validate through the same /provider/validate path, but water
// sends a "service" field and TV sends a "billType" field — that's what
// the docs show for each, just flagging it since it's a shared endpoint.
// See the comments above validateWaterMeter / validateTvSmartcard below.

import { toLocalGhanaNumber } from "./networkValidation.js";

const TECHLINK_BASE = process.env.TECHLINK_API_BASE_URL || "https://api.techlinkgh.com/api/v1";
const TECHLINK_KEY = process.env.TECHLINK_API_KEY;

// Techlink expects these exact network codes — not the ids we use
// internally in the UI (mtn/telecel/airteltigo).
const NETWORK_CODE = { mtn: "MTN", telecel: "TELECEL", airteltigo: "AT" };

function toNetworkCode(id) {
  const code = NETWORK_CODE[id] || (id || "").toUpperCase();
  return code;
}

// Thrown when we cannot know whether Techlink acted on the request: the
// connection failed or timed out, or Techlink answered 5xx. For a
// value-moving call (airtime, data, bills, AFA, checkers...) that means the
// order MAY already have been delivered and the wallet MAY already have been
// debited, so it must NEVER be blindly resubmitted — see fulfillClaimedOrder
// in lib/orderProcessing.js. Definite rejections (4xx, or a body with
// success:false) are plain Errors and are safe to retry.
export class TechlinkAmbiguousError extends Error {
  constructor(message) {
    super(message);
    this.name = "TechlinkAmbiguousError";
    this.ambiguous = true;
  }
}

const TECHLINK_TIMEOUT_MS = Number(process.env.TECHLINK_TIMEOUT_MS || 20000);

async function tlFetch(path, options = {}) {
  if (!TECHLINK_KEY) {
    throw new Error("TECHLINK_API_KEY is not set — add it to your environment before placing real orders.");
  }
  let res;
  try {
    res = await fetch(`${TECHLINK_BASE}${path}`, {
      signal: AbortSignal.timeout(TECHLINK_TIMEOUT_MS),
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TECHLINK_KEY,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    throw new TechlinkAmbiguousError(`Techlink request did not complete (${err.name === "TimeoutError" ? "timed out" : err.message}): ${path}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status >= 500) {
    const err = new TechlinkAmbiguousError(data.message || data.error || `Techlink server error (${res.status}): ${path}`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok || data.success === false) {
    const err = new Error(data.message || data.error || `Techlink request failed (${res.status}): ${path}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- Airtime ---------------- */

// Public — the % fee Techlink adds on top of face value when debiting
// YOUR Techlink wallet (not the customer). Useful for showing "+2% service
// fee" in your own admin view, or for deciding your customer-facing price.
export async function getAirtimeFee() {
  return tlFetch("/products/airtime-fee"); // { percent, rate }
}

// Your business's own Techlink wallet balance — every order (airtime, data,
// bills, AFA, TV, checkers) debits this wallet, so it must stay funded.
// Not customer-facing; used to power a low-balance warning in the admin
// dashboard so fulfillment failures are caught before customers hit them.
export async function getWalletBalance() {
  return tlFetch("/wallet/balance");
}

export async function buyAirtime({ network, phone, amount }) {
  return tlFetch("/airtime", {
    method: "POST",
    body: JSON.stringify({ network: toNetworkCode(network), phone, amount }),
  });
}

/* ---------------- Data bundles (commission, provider's live catalogue) ---------------- */
// Prices here come straight from the network's own catalogue via Techlink,
// so there is nothing to hardcode or keep in sync — call listDataBundles
// to get real, current prices and valid bundleIds.

export async function listDataBundles({ network, phone }) {
  const params = new URLSearchParams({ network: toNetworkCode(network), phone });
  return tlFetch(`/data/bundles?${params.toString()}`);
}

export async function buyData({ network, phone, bundleId }) {
  return tlFetch("/data/purchase", {
    method: "POST",
    body: JSON.stringify({ network: toNetworkCode(network), phone, bundleId }),
  });
}

/* ---------------- Agent Data Products (Techlink's own catalogue) ---------------- */
// MTN Master/Express, AT iShare/BigTime, Telecel Group Share. Separate
// from the commission "Data bundles" above — see docs: "sold from our own
// catalogue... Not available on the main API." Supports single, bulk, and
// (via the bulk endpoint — see note in pages/api/orders/create.js) Excel
// upload.

export async function listProducts(category) {
  return tlFetch(`/products?category=${encodeURIComponent(category)}`);
}

export async function purchaseDataSingle({ name, network, phone, size }) {
  return tlFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      name,
      network: toNetworkCode(network),
      phone,
      size,
      paymentMethod: "wallet", // you've already collected payment yourself via Paystack
      type: "single",
      callbackUrl: "",
    }),
  });
}

export async function purchaseDataBulk({ orders }) {
  return tlFetch("/orders/bulk", {
    method: "POST",
    body: JSON.stringify({
      orders: orders.map((o) => ({ ...o, network: toNetworkCode(o.network) })),
    }),
  });
}

export async function purchaseAirtimeBulk({ orders }) {
  return tlFetch("/orders/airtime/bulk", {
    method: "POST",
    body: JSON.stringify({
      orders: orders.map((o) => ({ ...o, network: toNetworkCode(o.network) })),
    }),
  });
}

/* ---------------- ECG electricity (prepaid top-up) ---------------- */

// Techlink's dashboard shows the account name, address, meter type and region
// for an ECG meter (e.g. "HFC BANK / <address> / POSTPAID · Western"), but the
// public API docs only show `customerName` and `district`. Real responses use
// other field names, and the old code passed the raw response straight through,
// so the page rendered "Meter belongs to" with an empty name. Everything is now
// mapped to ONE stable shape, and only these whitelisted fields are ever sent
// on to the browser.
const ECG_FIELD_ALIASES = {
  customerName: ["customerName", "customer_name", "accountName", "account_name", "name", "meterName", "meter_name", "holderName", "ownerName", "customer"],
  address: ["address", "location", "physicalAddress", "physical_address", "streetAddress", "premises"],
  meterType: ["meterType", "meter_type", "accountType", "account_type", "paymentType", "payment_type", "billingType", "billing_type", "meterCategory", "type"],
  region: ["region", "regionName", "district", "area"],
};

function ecgPick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Last resort for the name only: any string field whose key contains "name",
// skipping keys that clearly aren't the account holder.
function ecgGuessName(obj) {
  for (const [key, value] of Object.entries(obj || {})) {
    if (/name/i.test(key) && !/(product|service|network|provider|bill|file|user|bank)/i.test(key) && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function ecgUnwrap(data) {
  let cur = data;
  for (let i = 0; i < 2; i += 1) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      const inner = cur.data ?? cur.result ?? cur.account;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) { cur = inner; continue; }
    }
    break;
  }
  return cur;
}

function toEcgRecord(item, requestedMeter) {
  const customerName = ecgPick(item, ECG_FIELD_ALIASES.customerName) || ecgGuessName(item);
  if (!customerName) return null;
  const meterValue = item?.meter ?? item?.meterNumber ?? item?.account ?? item?.accountNumber ?? requestedMeter;
  return {
    meter: String(meterValue || requestedMeter || ""),
    customerName,
    address: ecgPick(item, ECG_FIELD_ALIASES.address),
    meterType: ecgPick(item, ECG_FIELD_ALIASES.meterType).toUpperCase(),
    region: ecgPick(item, ECG_FIELD_ALIASES.region),
  };
}

// Returns a normalized record, null (nothing matched), or the string
// "unreadable" (Techlink answered for this meter but we can't find a name).
function normalizeEcgLookupResponse(data, requestedMeter = "") {
  if (!data) return null;
  const root = ecgUnwrap(data);

  if (root && typeof root === "object" && !Array.isArray(root)) {
    const direct = toEcgRecord(root, requestedMeter);
    if (direct) return direct;
  }

  const candidates = Array.isArray(root)
    ? root
    : (Array.isArray(root?.meters) ? root.meters
      : Array.isArray(root?.data) ? root.data
      : Array.isArray(root?.results) ? root.results
      : []);

  const target = String(requestedMeter || "").replace(/\D/g, "");
  const match = candidates.find((item) => {
    const candidateMeter = String(item?.meter ?? item?.meterNumber ?? item?.account ?? item?.accountNumber ?? "").replace(/\D/g, "");
    return target && candidateMeter === target;
  }) || (candidates.length === 1 ? candidates[0] : null);

  if (match) return toEcgRecord(match, requestedMeter) || "unreadable";

  // A single object that names our meter but has no readable holder name.
  if (root && typeof root === "object" && !Array.isArray(root) && (root.meter || root.meterNumber || root.success === true)) {
    return "unreadable";
  }
  return null;
}

// Techlink's own ECG page refuses to look a meter up until a phone number is
// entered ("Enter your phone number below, and we will look the meter up
// automatically"), and a meter-only call does not work in practice even though
// the Postman docs show one. So the lookup is ALWAYS meter + phone, sent
// together in a single call, with the phone in Techlink's local 10-digit form.
export const normalizeGhanaPhone = toLocalGhanaNumber;

export async function lookupEcgMeter({ meter, phone } = {}) {
  const requestedMeter = String(meter || "").replace(/\s+/g, "");
  const requestedPhone = normalizeGhanaPhone(phone);

  if (!requestedMeter || !requestedPhone) {
    const err = new Error("ECG meter number and a valid telephone number are both required");
    err.status = 400;
    throw err;
  }

  // One call, both params. There is deliberately NO meter-only retry: it can
  // never succeed without the phone, and retrying only replaced the real
  // provider error (invalid phone, not found, ...) with a misleading one.
  // normalizeEcgLookupResponse still matches a phone-keyed list of meters back
  // to the requested meter.
  const params = new URLSearchParams({ meter: requestedMeter, phone: requestedPhone });
  const data = await tlFetch(`/ecg/lookup?${params.toString()}`);
  const resolved = normalizeEcgLookupResponse(data, requestedMeter);

  // Techlink answered for this meter but the payload has no account-holder
  // name we recognise. Never show a blank "Meter belongs to" and let the
  // customer pay for an unconfirmed recipient: fail loudly instead. Only the
  // KEYS are logged (no customer data) so the field name can be added above.
  if (resolved === "unreadable") {
    const root = ecgUnwrap(data);
    console.error("ECG lookup: Techlink returned a response with no readable customer name. Response keys:", root && typeof root === "object" ? Object.keys(root) : typeof root);
    const err = new Error("ECG account name could not be read from the provider response");
    err.code = "ECG_NAME_UNREADABLE";
    throw err;
  }

  if (!resolved) {
    const err = new Error("ECG meter/account could not be resolved");
    err.status = 404;
    throw err;
  }

  return resolved;
}

export async function buyElectricity({ meter, amount, phone }) {
  // Send exactly what the lookup verified: same whitespace-free meter and the
  // same local 10-digit phone (a customer may have typed "024 286 3004" or
  // "+233...", which the lookup accepted after normalising).
  return tlFetch("/ecg", {
    method: "POST",
    body: JSON.stringify({
      meter: String(meter || "").replace(/\s+/g, ""),
      amount,
      phone: normalizeGhanaPhone(phone) || phone,
    }),
  });
}

/* ---------------- Ghana Water (fixed bill amount, not prepaid) ---------------- */
// Confirmed against the docs: /korba/validate (billType: "WATER") is the
// primary validator under the plain "Water" section. /provider/validate
// with service: "GWCL" is a separately-documented alternate specifically
// for GWCL accounts — use it as a fallback if the primary doesn't resolve
// a given account.

export async function validateWaterMeter({ account, phone }) {
  let primaryError = null;

  try {
    const data = await tlFetch("/korba/validate", {
      method: "POST",
      body: JSON.stringify({ billType: "WATER", account }),
    });
    const resolvedAmount = Number(data.balance ?? data.amountDue ?? data.amount);
    if (Number.isFinite(resolvedAmount) && resolvedAmount > 0) return data;
    primaryError = new Error("Water validation returned no payable balance");
    primaryError.status = 422;
  } catch (err) {
    primaryError = err;
  }

  // The same supplied Techlink documentation also defines a GWCL validator
  // that accepts account + phone. Use it when the primary Water validator
  // cannot resolve the bill before the customer reaches payment.
  if (phone) {
    const fallback = await validateGwclMeter({ account, phone });
    const resolvedAmount = Number(fallback?.balance ?? fallback?.amountDue ?? fallback?.amount);
    if (Number.isFinite(resolvedAmount) && resolvedAmount > 0) {
      return fallback;
    }
  }

  throw primaryError || new Error("Could not resolve the water account");
}

// Fallback validator, explicitly named for GWCL in the docs.
export async function validateGwclMeter({ account, phone }) {
  return tlFetch("/provider/validate", {
    method: "POST",
    body: JSON.stringify({ service: "GWCL", account, phone }),
  });
}

export async function payWaterBill({ meter, amount, phone }) {
  return tlFetch("/water", {
    method: "POST",
    body: JSON.stringify({ meter, amount, phone }),
  });
}

/* ---------------- TV subscriptions (fixed bill amount) ---------------- */
// Confirmed against the docs: TV smartcard validation shares the same
// /provider/validate path as GWCL water validation above, but the two
// send a different key — TV sends "billType", GWCL sends "service". That's
// what the docs literally show for each; worth one live test call to
// double-check /provider/validate actually branches correctly on that key,
// but this isn't a guess about which endpoint to call, just a small
// naming quirk on a shared path.

export async function validateTvSmartcard({ billType, account }) {
  return tlFetch("/provider/validate", {
    method: "POST",
    body: JSON.stringify({ billType, account }), // billType: DSTV | GOTV | STARTIMES
  }); // { customerName, package, amountDue }
}

export async function payTvSubscription({ service, account, amount }) {
  return tlFetch("/tv", {
    method: "POST",
    body: JSON.stringify({ service, account, amount }), // service: DSTV | GOTV | STARTIMES
  });
}

/* ---------------- Result checkers (BECE / WASSCE vouchers) ---------------- */

export async function getCheckerPrices() {
  return tlFetch("/products/checker-prices"); // public
}

export async function purchaseChecker({ type, quantity, deliveryMethod }) {
  return tlFetch("/result-checker/purchase", {
    method: "POST",
    body: JSON.stringify({ type, quantity, deliveryMethod }), // type: BECE | WASSCE, deliveryMethod: email | sms
  });
}

/* ---------------- "Check it for you" result-lookup service ---------------- */
// A different, higher-touch service from the voucher purchase above — we
// look the result up and email/SMS it, rather than selling a self-service
// voucher. Not instant: results come back once someone has actually
// processed the request.

export async function getResultCheckServicePrices() {
  return tlFetch("/result-check-service/prices"); // public
}

export async function requestResultCheck({ type, indexNumber, examYear, candidateName, email }) {
  return tlFetch("/result-check-service/request", {
    method: "POST",
    body: JSON.stringify({ type, indexNumber, examYear, candidateName, email }), // type: bece | wassce
  });
}

/* ---------------- AFA registration ---------------- */

export async function getAfaPrice() {
  return tlFetch("/products/afa-price"); // public
}

export async function registerAfa({ network, fullName, ghanaCard, phone, dob, region, location, occupation }) {
  return tlFetch("/afa/register", {
    method: "POST",
    body: JSON.stringify({
      // Use the formal request-body field names documented for POST /afa/register.
      // The exported curl example in the same document uses older aliases
      // (name/idNumber/dateOfBirth); do not send both shapes to a strict validator.
      fullName,
      phone,
      ghanaCard,
      dob,
      region,
      location,
      occupation,
      // "wallet" charges your own Techlink wallet immediately, which is
      // correct here since you've already collected payment from the
      // customer yourself via Paystack. Techlink's API also supports
      // paymentMethod: "paystack" (it hands back its own checkout URL),
      // but that would be a second, separate charge through Techlink's
      // own Paystack account — don't use it alongside your own flow.
      paymentMethod: "wallet",
    }),
  });
}

// Re-checks a queued order with Techlink directly — for non-instant tiers
// (currently MTN Master) where Techlink's own docs say the initial
// "success" response only confirms the order was accepted into their
// queue, not that it actually reached the recipient's phone yet
// ("providers settle asynchronously and a callback can be lost").
// Techlink's own order history ("Get My Orders", paginated). Used ONLY to give
// an admin evidence about whether an order was delivered (see
// lib/techlinkMatch.js). The Postman docs show { rows: [...] } but not the
// pagination fields, so this reads defensively and stops when a page comes
// back short, empty, or older than we care about.
export async function fetchRecentTechlinkOrders({ maxPages = 3, limit = 100, stopBefore = null } = {}) {
  const all = [];
  let exhausted = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await tlFetch(`/orders?page=${page}&limit=${limit}`);
    const rows = Array.isArray(data) ? data : (data.rows || data.orders || data.data || []);
    all.push(...rows);
    if (rows.length < limit) { exhausted = true; break; }
    const times = rows.map((r) => new Date(r.createdAt ?? r.created_at ?? 0).getTime()).filter((t) => t > 0);
    if (stopBefore && times.length && Math.min(...times) <= new Date(stopBefore).getTime()) break;
  }
  const times = all.map((r) => new Date(r.createdAt ?? r.created_at ?? 0).getTime()).filter((t) => t > 0);
  return { rows: all, exhausted, oldestFetchedAt: times.length ? new Date(Math.min(...times)).toISOString() : null };
}

export async function verifyOrderStatus(orderId) {
  return tlFetch(`/orders/${encodeURIComponent(orderId)}/verify`, { method: "POST" });
}

/**
 * Called once a payment has been verified as successful. Dispatches to the
 * right Techlink action based on the order type stored when the order was
 * created. This is the ONLY place that should ever deliver value to a
 * customer — it must only run after verifyTransaction() confirms payment.
 */
export async function fulfillOrder(order) {
  switch (order.orderType) {
    case "airtime":
      return buyAirtime({ network: order.network, phone: order.phone, amount: order.amount });

    case "data":
      return buyData({ network: order.network, phone: order.phone, bundleId: order.bundleId });

    case "tierData":
      return purchaseDataSingle({
        name: order.tierDetails?.name,
        network: order.network,
        phone: order.phone,
        size: order.tierDetails?.size,
      });

    case "tierBulkData":
      return purchaseDataBulk({
        orders: (order.tierDetails?.rows || []).map((r) => ({
          name: r.name,
          network: order.network,
          phone: r.phone,
          size: r.size,
        })),
      });

    case "tierBulkAirtime":
      return purchaseAirtimeBulk({
        orders: (order.tierDetails?.rows || []).map((r) => ({
          network: order.network,
          phone: r.phone,
          amount: r.amount,
        })),
      });

    case "afa":
      return registerAfa({
        network: order.network,
        fullName: order.afaDetails?.fullName,
        ghanaCard: order.afaDetails?.ghanaCard,
        phone: order.phone,
        dob: order.afaDetails?.dob,
        region: order.afaDetails?.region,
        location: order.afaDetails?.location,
        occupation: order.afaDetails?.occupation,
      });

    case "ecg":
      return buyElectricity({ meter: order.meterNumber, amount: order.amount, phone: order.phone });

    case "water":
      return payWaterBill({ meter: order.meterNumber, amount: order.amount, phone: order.phone });

    case "tv":
      return payTvSubscription({
        service: order.tvDetails?.service,
        account: order.meterNumber, // smartcard number, reusing the same column
        amount: order.amount,
      });

    case "checker":
      if (order.checkerDetails?.mode === "lookup") {
        return requestResultCheck({
          // The UI only ever produces uppercase "BECE"/"WASSCE" (correct for
          // /result-checker/purchase below), but the docs' own example body
          // for /result-check-service/request shows lowercase "bece"/"wassce".
          // Lowercase it here so a paid lookup order doesn't fail at Techlink
          // over letter case.
          type: String(order.checkerDetails?.type || "").toLowerCase(),
          indexNumber: order.checkerDetails?.indexNumber,
          examYear: order.checkerDetails?.examYear,
          candidateName: order.checkerDetails?.candidateName,
          email: order.email,
        });
      }
      return purchaseChecker({
        type: order.checkerDetails?.type,
        quantity: order.checkerDetails?.quantity,
        deliveryMethod: order.checkerDetails?.deliveryMethod,
      });

    default:
      throw new Error(`Unknown order type: ${order.orderType}`);
  }
}
