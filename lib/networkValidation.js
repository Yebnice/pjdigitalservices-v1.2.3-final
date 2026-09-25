// Ghana mobile-network prefix hints used for customer safety checks.
// These identify common assigned ranges, but they are only hints because
// Mobile Number Portability allows a subscriber to keep a number after
// changing operators.
export const NETWORK_PREFIXES = {
  mtn: ["024", "025", "053", "054", "055", "059"],
  telecel: ["020", "050"],
  airteltigo: ["026", "027", "056", "057"],
};

export const AIRTELTIGO_PREFIXES = NETWORK_PREFIXES.airteltigo;

export function normalizeGhanaPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("233") ? "0" + digits.slice(3) : digits;
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
