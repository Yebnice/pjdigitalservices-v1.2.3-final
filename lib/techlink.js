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

function normalizeEcgLookupResponse(data, requestedMeter = "") {
  if (!data) return null;

  if (data.meter || data.customerName || data.accountName) {
    return {
      ...data,
      meter: data.meter || requestedMeter,
    };
  }

  const candidates = Array.isArray(data)
    ? data
    : (Array.isArray(data.meters) ? data.meters
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.results) ? data.results
      : []);

  const target = String(requestedMeter || "").replace(/\D/g, "");
  const match = candidates.find((item) => {
    const candidateMeter = String(item?.meter ?? item?.meterNumber ?? item?.account ?? item?.accountNumber ?? "").replace(/\D/g, "");
    return target && candidateMeter === target;
  }) || (candidates.length === 1 ? candidates[0] : null);

  if (!match) return null;

  return {
    ...match,
    meter: match.meter || match.meterNumber || match.account || match.accountNumber || requestedMeter,
    customerName: match.customerName || match.accountName || match.name,
  };
}

export async function lookupEcgMeter({ meter, phone } = {}) {
  const requestedMeter = String(meter || "").trim();
  const requestedPhone = String(phone || "").trim();

  try {
    const data = await tlFetch(`/ecg/lookup?meter=${encodeURIComponent(requestedMeter)}`);
    const resolved = normalizeEcgLookupResponse(data, requestedMeter);
    if (resolved) return resolved;
  } catch (meterErr) {
    // The Techlink documentation says ECG lookup can also be queried by
    // phone to list meters linked to that number. Use that documented
    // alternative before reporting the meter as unresolved.
    if (requestedPhone) {
      const data = await tlFetch(`/ecg/lookup?phone=${encodeURIComponent(requestedPhone)}`);
      const resolved = normalizeEcgLookupResponse(data, requestedMeter);
      if (resolved) return resolved;
    }
    throw meterErr;
  }

  if (requestedPhone) {
    const data = await tlFetch(`/ecg/lookup?phone=${encodeURIComponent(requestedPhone)}`);
    const resolved = normalizeEcgLookupResponse(data, requestedMeter);
    if (resolved) return resolved;
  }

  const err = new Error("ECG meter/account could not be resolved");
  err.status = 404;
  throw err;
}

export async function buyElectricity({ meter, amount, phone }) {
  return tlFetch("/ecg", {
    method: "POST",
    body: JSON.stringify({ meter, amount, phone }),
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
