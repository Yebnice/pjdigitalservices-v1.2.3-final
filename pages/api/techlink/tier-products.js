import { listProducts } from "../../../lib/techlink";
import { TIERS } from "../../../lib/agentProducts";
import { rateLimit } from "../../../lib/rateLimit";
import { getOrderPricing } from "../../../lib/pricing";

// Lets the bundle picker check, before the customer ever taps a tile,
// which sizes Techlink's live catalogue actually has right now — so a
// customer never picks something that will only fail at checkout (see
// the "no longer available" error surfaced late in pages/api/orders/create.js).
// Only exposes size + price, never raw Techlink response shape or keys.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const rl = await rateLimit(req, { limit: 30, windowMs: 60_000, keySuffix: "tier-products" });
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  const tierKey = String(req.query.tierKey || "");
  const tier = TIERS[tierKey];
  if (!tier) return res.status(400).json({ error: "Unknown tier" });

  try {
    const catalogue = await listProducts(tier.category);
    // Techlink's docs show GET /products returns a plain JSON array
    // directly — not wrapped in {products: [...]} or {data: [...]}. Handle
    // both shapes defensively in case that ever changes.
    const products = Array.isArray(catalogue) ? catalogue : (catalogue.products || catalogue.data || []);
    const sizes = products
      .map((p) => {
        const providerPrice = Number(p.price ?? p.amount);
        if (!Number.isFinite(providerPrice) || providerPrice <= 0 || !Number.isFinite(Number(p.size)) || Number(p.size) <= 0) {
          return null;
        }
        const single = getOrderPricing({
          providerCost: providerPrice,
          customerBaseAmount: providerPrice,
          orderType: "tierData",
          network: tier.network,
        });
        const bulk = getOrderPricing({
          providerCost: providerPrice,
          customerBaseAmount: providerPrice,
          orderType: "tierBulkData",
          network: tier.network,
        });
        return {
          size: Number(p.size),
          // Public catalogue values are customer-facing only. Never expose
          // Techlink provider cost or PjDigitalServices margin fields here.
          price: single.customerProductAmount,
          checkoutPrice: single.checkoutAmount,
          bulkPrice: bulk.customerProductAmount,
          bulkCheckoutPrice: bulk.checkoutAmount,
        };
      })
      .filter(Boolean);
    return res.status(200).json({ sizes });
  } catch (err) {
    // If Techlink is briefly unreachable, don't break the picker for the
    // customer — report "unknown" so the UI falls back to showing every
    // size as available, same as before this endpoint existed.
    console.error("tier-products lookup failed", err.message);
    return res.status(200).json({ sizes: null });
  }
}
