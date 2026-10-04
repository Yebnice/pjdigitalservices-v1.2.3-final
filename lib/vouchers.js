// Result-checker vouchers (BECE / WASSCE). Per the Techlink Business API V1
// Postman document, POST /result-checker/purchase answers with
//   { success, message, orderId, checkers: [{ serialNumber, pin, type }] }
// The customer paid for exactly those serial numbers and PINs, so the app must
// capture them and hand them to the customer itself. The purchase request has
// NO recipient field, so Techlink cannot deliver them to the customer.
//
// Pure functions only.

const CLEAN = /[^A-Za-z0-9-]/g;

export function extractVouchers(result) {
  const list = Array.isArray(result?.checkers) ? result.checkers : [];
  const out = [];
  for (const v of list.slice(0, 50)) {
    const serialNumber = String(v?.serialNumber ?? v?.serial ?? "").replace(CLEAN, "").slice(0, 40);
    const pin = String(v?.pin ?? "").replace(CLEAN, "").slice(0, 40);
    if (!serialNumber || !pin) continue;
    out.push({ type: String(v?.type || "").replace(CLEAN, "").toUpperCase().slice(0, 12), serialNumber, pin });
  }
  return out;
}

// A purchase of N vouchers is only "delivered" if N usable vouchers came back.
export function vouchersComplete(result, quantity) {
  const need = Math.max(1, Number(quantity) || 1);
  return extractVouchers(result).length >= need;
}

export function isVoucherOrder(order) {
  return order?.orderType === "checker" && order?.checkerDetails?.mode !== "lookup";
}
