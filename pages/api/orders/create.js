import crypto from "crypto";
import { createOrder, getOrderByIdempotencyKey } from "../../../lib/store";
import {
  listDataBundles,
  getAfaPrice,
  validateWaterMeter,
  validateTvSmartcard,
  getCheckerPrices,
  getResultCheckServicePrices,
  listProducts,
  getAirtimeFee,
} from "../../../lib/techlink";
import { TIERS } from "../../../lib/agentProducts";
import { rateLimit } from "../../../lib/rateLimit";
import { getOrderPricing } from "../../../lib/pricing";

// Every price here is resolved from Techlink itself at order time — never
// from anything the browser sends — so a customer can never pay less (or
// more) than what Techlink will actually charge your wallet.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = rateLimit(req, { limit: 12, windowMs: 60_000, keySuffix: "orders-create" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many order attempts. Please wait a moment and try again." });
  const rawIdempotency = req.headers["idempotency-key"] || req.body?.idempotencyKey || "";
  const idempotencyKey = String(Array.isArray(rawIdempotency) ? rawIdempotency[0] : rawIdempotency).trim();
  if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 128)) {
    return res.status(400).json({ error: "Invalid idempotency key" });
  }
  if (idempotencyKey) {
    try {
      const existing = await getOrderByIdempotencyKey(idempotencyKey);
      if (existing) {
        return res.status(200).json({
          reference: existing.reference,
          amount: existing.checkoutAmount,
          productAmount: existing.customerProductAmount ?? existing.amount,
          providerCost: existing.amount,
          markupAmount: existing.businessMarkupAmount ?? 0,
          feeAmount: existing.paystackFeeAmount ?? 0,
          reused: true,
        });
      }
    } catch (err) {
      console.error("Idempotency lookup failed", err.message);
    }
  }

  const MAX_BULK_ROWS = Math.max(1, Math.min(500, Number(process.env.MAX_BULK_ROWS || 100)));
  const MAX_BULK_TOTAL_GHS = Math.max(1, Number(process.env.MAX_BULK_TOTAL_GHS || 5000));
  const MAX_BULK_LINE_GHS = Math.max(1, Number(process.env.MAX_BULK_LINE_GHS || 500));
  const MAX_ORDER_PRODUCT_GHS = Math.max(1, Number(process.env.MAX_ORDER_PRODUCT_GHS || 10000));

  // Catalog/pricing failures (a bundle that's no longer available, a
  // provider lookup that can't resolve an amount, etc.) happen before an
  // order ever exists, so previously they vanished with no record at all —
  // the admin dashboard's Orders list had nothing to show for a customer
  // who hit exactly this wall. Logging them as a "failed" order (amount 0,
  // no charge ever happened) gives them a reference and makes them visible,
  // the same way a failed payment already is. Plain input mistakes (bad
  // email format, missing phone) are NOT logged here — those aren't real
  // transaction attempts, just typos, and would only add noise.
  async function logFailedAttempt(reason, { orderType, network, phone, email }) {
    const reference = `TL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    try {
      await createOrder({
        reference,
        orderType,
        network: network || orderType,
        phone: phone || "—",
        email: String(email || "").trim().toLowerCase(),
        amount: 0,
        status: "failed",
        failReason: reason,
      });
    } catch (logErr) {
      console.error("Could not log failed order attempt:", logErr.message);
    }
    return reference;
  }

  try {
    const {
      orderType, network, phone, email,
      bundleId,
      afaDetails,
      airtimeAmount,
      meterNumber, billAmount,
      tvDetails,
      checkerDetails,
      tierKey, size, rows,
    } = req.body;

    if (!orderType || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const isBulk = orderType === "tierBulkData" || orderType === "tierBulkAirtime";
    if (isBulk && Array.isArray(rows) && rows.length > MAX_BULK_ROWS) {
      return res.status(400).json({ error: `Bulk orders are limited to ${MAX_BULK_ROWS} lines per order` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: "Enter a valid email address" });
    if (!isBulk && !phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    if (!isBulk && !/^[+0-9][0-9\s-]{7,20}$/.test(String(phone))) return res.status(400).json({ error: "Enter a valid phone number" });
    let resolvedNetwork = network; // may be overridden below for tier orders — see note there

    const normalizedEmail = String(email).trim().toLowerCase();
    let amount;
    let providerCost;
    let extra = {};

    if (orderType === "airtime") {
      if (!network) return res.status(400).json({ error: "Network is required" });
      amount = Number(airtimeAmount);
      if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
      const airtimeFeeData = await getAirtimeFee();
      const airtimeFeeRate = Number(airtimeFeeData.rate ?? airtimeFeeData.percent / 100 ?? 0);
      if (!Number.isFinite(airtimeFeeRate) || airtimeFeeRate < 0 || airtimeFeeRate > 1) return res.status(500).json({ error: "Could not determine the provider airtime fee" });
      providerCost = Math.round(amount * (1 + airtimeFeeRate) * 100) / 100;

    } else if (orderType === "data") {
      if (!network) return res.status(400).json({ error: "Network is required" });
      if (!bundleId) return res.status(400).json({ error: "Select a bundle" });
      // Re-fetch the live catalogue to find the authoritative price for
      // this bundleId — the price shown to the customer must have come
      // from here in the first place, so this should always find a match.
      const catalogue = await listDataBundles({ network, phone });
      const bundles = catalogue.bundles || catalogue.data || [];
      const bundle = bundles.find((b) => (b.id || b.bundleId) === bundleId);
      if (!bundle) {
        const reference = await logFailedAttempt("bundle_unavailable", { orderType, network, phone, email });
        return res.status(400).json({ error: "That bundle is no longer available — refresh and pick again", reference });
      }
      amount = Number(bundle.price ?? bundle.amount);

    } else if (orderType === "afa") {
      if (!network) return res.status(400).json({ error: "Network is required" });
      if (!afaDetails?.fullName || !afaDetails?.ghanaCard || !afaDetails?.dob || !afaDetails?.region || !afaDetails?.location || !afaDetails?.occupation) {
        return res.status(400).json({ error: "Missing AFA registration details" });
      }
      const priceData = await getAfaPrice();
      amount = Number(priceData.price ?? priceData.amount);

    } else if (orderType === "ecg") {
      if (!meterNumber) return res.status(400).json({ error: "Meter number is required" });
      amount = Number(billAmount);
      if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    } else if (orderType === "water") {
      if (!meterNumber) return res.status(400).json({ error: "Account number is required" });
      // Water is a fixed bill amount, resolved from Techlink's validation —
      // never from a number the customer typed in themselves.
      const validation = await validateWaterMeter({ account: meterNumber });
      // Techlink's docs show /korba/validate returns "balance" (as a
      // string, e.g. "124.50") for the amount owed — not "amountDue". This
      // was the actual reason every water bill payment failed to resolve
      // an amount, regardless of the account's real balance.
      amount = Number(validation.balance ?? validation.amountDue ?? validation.amount);
      if (!amount || amount <= 0) {
        const reference = await logFailedAttempt("water_amount_unresolved", { orderType, network: "water", phone, email });
        return res.status(400).json({ error: "Could not resolve a bill amount for that account", reference });
      }
      extra.billAccountName = validation.accountName || validation.customerName || null;

    } else if (orderType === "tv") {
      if (!meterNumber || !tvDetails?.service) return res.status(400).json({ error: "Smartcard number and provider are required" });
      const validation = await validateTvSmartcard({ billType: tvDetails.service, account: meterNumber });
      // Same field-name issue as water above: Techlink's docs show
      // /provider/validate returns "balance" for the amount due, and
      // "packageName" for the subscription package — not "amountDue" or
      // "package". This was blocking every TV subscription payment.
      amount = Number(validation.balance ?? validation.amountDue ?? validation.amount);
      if (!amount || amount <= 0) {
        const reference = await logFailedAttempt("tv_amount_unresolved", { orderType, network: tvDetails?.service, phone, email });
        return res.status(400).json({ error: "Could not resolve an amount due for that smartcard", reference });
      }
      extra.tvDetails = { ...tvDetails, customerName: validation.customerName || null, package: validation.packageName || validation.package || null };

    } else if (orderType === "checker") {
      if (!checkerDetails?.type) return res.status(400).json({ error: "Checker type is required" });
      if (checkerDetails.mode === "lookup") {
        if (!checkerDetails.indexNumber || !checkerDetails.examYear) {
          return res.status(400).json({ error: "Index number and exam year are required" });
        }
        const prices = await getResultCheckServicePrices();
        const row = (prices.prices || prices.data || []).find((p) => (p.type || "").toLowerCase() === checkerDetails.type.toLowerCase());
        amount = Number(row?.price ?? prices.price);
      } else {
        const quantity = Number(checkerDetails.quantity) || 1;
        const prices = await getCheckerPrices();
        const row = (prices.prices || prices.data || []).find((p) => (p.type || "").toLowerCase() === checkerDetails.type.toLowerCase());
        amount = Number(row?.price ?? prices.price) * quantity;
      }
      if (!amount || amount <= 0) {
        const reference = await logFailedAttempt("checker_price_unresolved", { orderType, network: checkerDetails?.type, phone, email });
        return res.status(400).json({ error: "Could not resolve a price for that checker", reference });
      }
      extra.checkerDetails = checkerDetails;

    } else if (orderType === "tierData") {
      const tier = TIERS[tierKey];
      if (!tier) return res.status(400).json({ error: "Unknown product tier" });
      if (!size) return res.status(400).json({ error: "Select a bundle size" });
      resolvedNetwork = tier.network; // never trust a client-sent network for a tier order — the tier decides it
      // Authoritative price + exact product name come from Techlink's own
      // catalogue right now — never from the browser or the local reference file.
      const catalogue = await listProducts(tier.category);
      // Techlink's docs show this endpoint returns a plain array directly,
      // not wrapped in {products: [...]} — this was the actual reason
      // every purchase attempt for these tiers failed as "no longer
      // available", regardless of what was really in the catalogue.
      const products = Array.isArray(catalogue) ? catalogue : (catalogue.products || catalogue.data || []);
      const product = products.find((p) => Number(p.size) === Number(size));
      if (!product) {
        const reference = await logFailedAttempt("tier_size_unavailable", { orderType, network: tier.network, phone, email });
        return res.status(400).json({ error: "That bundle size is no longer available", reference });
      }
      amount = Number(product.price ?? product.amount);
      extra.tierDetails = { tierKey, category: tier.category, size: Number(size), name: product.name };

    } else if (orderType === "tierBulkData") {
      const tier = TIERS[tierKey];
      if (!tier) return res.status(400).json({ error: "Unknown product tier" });
      resolvedNetwork = tier.network; // same hardening as tierData above
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "Add at least one order line" });
      const catalogue = await listProducts(tier.category);
      const products = Array.isArray(catalogue) ? catalogue : (catalogue.products || catalogue.data || []);
      const resolvedRows = [];
      for (const r of rows) {
        const product = products.find((p) => Number(p.size) === Number(r.size));
        if (!product || !r.phone) {
          const reference = await logFailedAttempt("tier_bulk_row_unavailable", { orderType, network: tier.network, phone: r.phone, email });
          return res.status(400).json({ error: `Could not price the line for ${r.phone || "an entry"} — check the size matches an available bundle`, reference });
        }
        if (!/^[+0-9][0-9\s-]{7,20}$/.test(String(r.phone))) {
          return res.status(400).json({ error: `Invalid phone number in bulk line: ${r.phone}` });
        }
        const rowPrice = Number(product.price ?? product.amount);
        if (!Number.isFinite(rowPrice) || rowPrice <= 0) return res.status(400).json({ error: `Invalid price for ${r.phone}` });
        resolvedRows.push({ phone: String(r.phone).trim(), size: Number(r.size), name: product.name, price: rowPrice });
      }
      amount = resolvedRows.reduce((sum, r) => sum + r.price, 0);
      extra.tierDetails = { tierKey, category: tier.category, rows: resolvedRows };

    } else if (orderType === "tierBulkAirtime") {
      if (!network) return res.status(400).json({ error: "Network is required" });
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "Add at least one order line" });
      const resolvedRows = [];
      for (const r of rows) {
        const rowAmount = Number(r.amount);
        if (!r.phone || !rowAmount || rowAmount <= 0) {
          return res.status(400).json({ error: `Invalid line for ${r.phone || "an entry"}` });
        }
        if (!/^[+0-9][0-9\s-]{7,20}$/.test(String(r.phone))) {
          return res.status(400).json({ error: `Invalid phone number in bulk line: ${r.phone}` });
        }
        if (rowAmount > MAX_BULK_LINE_GHS) return res.status(400).json({ error: `Each bulk airtime line is limited to GHS ${MAX_BULK_LINE_GHS.toFixed(2)}` });
        resolvedRows.push({ phone: String(r.phone).trim(), amount: rowAmount });
      }
      amount = resolvedRows.reduce((sum, r) => sum + r.amount, 0);
      const airtimeFeeData = await getAirtimeFee();
      const airtimeFeeRate = Number(airtimeFeeData.rate ?? airtimeFeeData.percent / 100 ?? 0);
      if (!Number.isFinite(airtimeFeeRate) || airtimeFeeRate < 0 || airtimeFeeRate > 1) return res.status(500).json({ error: "Could not determine the provider airtime fee" });
      providerCost = Math.round(amount * (1 + airtimeFeeRate) * 100) / 100;
      extra.tierDetails = { rows: resolvedRows, airtimeProviderFeeRate: airtimeFeeRate };

    } else {
      return res.status(400).json({ error: "Unknown order type" });
    }

    if (providerCost == null) providerCost = amount;
    if (isBulk && amount > MAX_BULK_TOTAL_GHS) {
      return res.status(400).json({ error: `Bulk orders are limited to a product total of GHS ${MAX_BULK_TOTAL_GHS.toFixed(2)}` });
    }
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Could not determine a valid order amount" });
    if (providerCost > MAX_ORDER_PRODUCT_GHS) return res.status(400).json({ error: `This order exceeds the maximum provider cost of GHS ${MAX_ORDER_PRODUCT_GHS.toFixed(2)}` });

    const reference = `TL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

    // `amount` is the customer-facing service/base amount used by the
    // fulfillment call. `providerCost` is the estimated wallet cost after
    // documented provider-side charges (notably Techlink airtime fees).
    // Customer-facing price then adds business markup and the Paystack fee.
    // What Techlink actually charges the business is represented by
    // `providerCost`. The customer is charged enough at checkout that,
    // after the 1.95% Paystack fee is deducted, PjDigitalServices still
    // receives `providerCost + business margin`. Fulfillment itself uses
    // `amount` for the provider request, never checkoutAmount — see lib/techlink.js.
    const pricing = getOrderPricing({ providerCost, orderType, network: resolvedNetwork || orderType });
    const checkoutAmount = pricing.checkoutAmount;

    const order = await createOrder({
      reference,
      orderType,
      network: resolvedNetwork || orderType,
      phone: isBulk ? `${rows.length} recipients` : phone,
      email: normalizedEmail,
      amount,
      providerCost,
      checkoutAmount,
      paystackFeeAmount: pricing.paystackFeeAmount,
      customerProductAmount: pricing.customerProductAmount,
      businessMarkupAmount: pricing.markupAmount,
      idempotencyKey: idempotencyKey || null,
      bundleId: bundleId || null,
      afaDetails: afaDetails || null,
      meterNumber: meterNumber || null,
      tvDetails: extra.tvDetails || tvDetails || null,
      checkerDetails: extra.checkerDetails || null,
      tierDetails: extra.tierDetails || null,
      status: "pending",
    });

    // `amount` in this response is what the customer is actually charged
    // at checkout (fee-inclusive) — the client uses it directly as the
    // Paystack popup amount. productAmount/feeAmount are included too so
    // the checkout UI can show a transparent breakdown before payment.
    res.status(200).json({
      reference: order.reference,
      amount: order.checkoutAmount,
      productAmount: order.customerProductAmount ?? order.amount,
      providerCost: order.providerCost,
      markupAmount: order.businessMarkupAmount ?? 0,
      feeAmount: order.paystackFeeAmount,
      reused: false,
    });
  } catch (err) {
    console.error("Order creation error", err);
    res.status(500).json({ error: "Something went wrong starting your order. Please try again in a moment." });
  }
}
