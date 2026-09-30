// Ghana mobile-network prefix hints used for customer safety checks.
// These identify common assigned ranges, but they are only hints because
// Mobile Number Portability allows a subscriber to keep a number after
// changing operators.
export const NETWORK_PREFIXES = {
  // Prefixes supported by current NCA numbering references for the three
  // networks this app sells to. These are only safety hints because
  // Mobile Number Portability can change a number's current network.
  // MTN also owns 025 and 053 (NCA numbering plan); they were missing, so
  // those numbers got no network hint or mismatch warning at all.
  mtn: ["024", "025", "053", "054", "055", "059"],
  telecel: ["020", "050"],
  airteltigo: ["026", "027", "056", "057"],
};

export const AIRTELTIGO_PREFIXES = NETWORK_PREFIXES.airteltigo;

export function normalizeGhanaPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("233") ? "0" + digits.slice(3) : digits;
}

// Ghana numbers are 0 + 9 digits. Accepts "024 123 4567", "+233 24 123 4567",
// "233241234567" and a bare 9-digit "241234567". Returns the local 10-digit
// form, or "" when the value cannot be a Ghana number. Techlink rejects
// anything else AFTER the customer has paid, so it must be caught up front.
export function toLocalGhanaNumber(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00233")) digits = digits.slice(5);
  else if (digits.startsWith("233") && digits.length === 12) digits = digits.slice(3);
  // A bare 9-digit number (leading 0 dropped, e.g. by Excel) gets its 0 back.
  // A 9-digit number that already starts with 0 is just a missing digit.
  if (digits.length === 9 && !digits.startsWith("0")) digits = `0${digits}`;
  return /^0\d{9}$/.test(digits) ? digits : "";
}

export function isValidGhanaNumber(value) {
  return toLocalGhanaNumber(value) !== "";
}

// Placeholder / example numbers per network so a page never shows an MTN
// prefix (024) on the AirtelTigo or Telecel screens.
const EXAMPLE_PREFIX = { mtn: "024", telecel: "020", airteltigo: "027" };

export function phonePlaceholder(network) {
  const prefix = EXAMPLE_PREFIX[network];
  return prefix ? `${prefix} 123 4567` : "0XX XXX XXXX";
}

export function bulkPlaceholder(network, kind) {
  const prefix = EXAMPLE_PREFIX[network] || "024";
  const [a, b] = kind === "data" ? ["5", "10"] : ["10", "20"];
  return `${prefix}XXXXXXX ${a}\n${prefix}YYYYYYY ${b}`;
}

export function samplePhones(network) {
  const prefix = EXAMPLE_PREFIX[network] || "024";
  return [`${prefix}0000001`, `${prefix}0000002`];
}

export function getLikelyNetwork(phone) {
  const local = normalizeGhanaPhone(phone);
  if (!local) return null;

  for (const [network, prefixes] of Object.entries(NETWORK_PREFIXES)) {
    if (prefixes.some((prefix) => local.startsWith(prefix))) return network;
  }

  return null;
}

export function isLikelyAirtelTigoNumber(phone) {
  return getLikelyNetwork(phone) === "airteltigo";
}
