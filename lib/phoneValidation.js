// Backward-compatible export for older imports. The canonical Ghana
// network-prefix logic lives in lib/networkValidation.js.
export {
  AIRTELTIGO_PREFIXES,
  getLikelyNetwork,
  isLikelyAirtelTigoNumber,
} from "./networkValidation.js";
