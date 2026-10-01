import { checkTechlinkEvidence } from "./orderProcessing";
import { listClaimedTechlinkIds } from "./adminStore";

// Evidence from Techlink's own history about one of our orders, with the
// purchases we already know belong to other orders taken out of the picture.
export async function evidenceForOrder(order) {
  let claimedOrderIds = new Set();
  try {
    claimedOrderIds = await listClaimedTechlinkIds(order.phone, order.reference);
  } catch (err) {
    console.error("Could not load claimed Techlink ids", order?.reference, err.message);
  }
  return checkTechlinkEvidence(order, { claimedOrderIds });
}
