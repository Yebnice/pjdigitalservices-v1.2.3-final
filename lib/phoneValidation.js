// Confirmed from Techlink's own AT iShare selling-rules panel: only these
// prefixes are AirtelTigo numbers. A wrong number is NOT refundable per
// their rules, so catching an obviously-wrong prefix before checkout
// protects both the customer and the business from an unrecoverable loss.
//
// Lives in lib/ (not components/ui.js, where this used to be defined) so
// it can be imported from server-side API routes without dragging a React
// component file into Node — see the AirtelTigo prefix check in
// pages/api/orders/create.js, which used to not exist at all: every
// AirtelTigo page only ever checked this client-side, so a bulk/Excel
// order, or any request made directly against the API, sailed straight
// through with no network-prefix check whatsoever.
export const AIRTELTIGO_PREFIXES = ["026", "056", "027", "057", "023", "053"];

export function isLikelyAirtelTigoNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  const local = digits.startsWith("233") ? "0" + digits.slice(3) : digits; // handle +233 entry
  return AIRTELTIGO_PREFIXES.some((p) => local.startsWith(p));
}
