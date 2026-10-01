// Pre-payment price guard. The customer is shown a total before tapping Pay;
// the server then works out the real total. If the two differ, the customer must
// agree to the new amount before the Paystack popup opens.
// Pure helpers: safe to import from both the browser and the tests.

export const DEFAULT_PRICE_TOLERANCE_GHS = 0.005; // anything under half a pesewa is rounding

export function priceDiffers(expected, actual, tolerance = DEFAULT_PRICE_TOLERANCE_GHS) {
  const e = Number(expected);
  const a = Number(actual);
  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(a)) return false; // nothing was shown, so nothing to compare
  return Math.abs(e - a) >= tolerance;
}

export function priceChangeMessage(expected, actual) {
  const e = Number(expected).toFixed(2);
  const a = Number(actual).toFixed(2);
  return `The price changed from GHS ${e} to GHS ${a}. Do you want to pay GHS ${a}?`;
}
