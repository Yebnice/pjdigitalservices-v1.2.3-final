import { useEffect, useState } from "react";
import { Loader2, Check, X, Bolt, Droplet, GraduationCap, Clock } from "lucide-react";

export const NETWORKS = {
  mtn: { label: "MTN", color: "var(--gold)", initial: "M", logo: "/icons/networks/mtn.png" },
  telecel: { label: "Telecel", color: "var(--red)", initial: "T", logo: "/icons/networks/telecel.png" },
  airteltigo: { label: "AirtelTigo", color: "var(--blue)", initial: "AT", logo: "/icons/networks/airteltigo.png" },
};

export const BILL_PROVIDERS = {
  // ECG's real mark is navy-blue-primary (with a yellow disc and red bolts),
  // not gold — corrected from the previous gold badge.
  ecg: { label: "ECG (Electricity)", color: "#0b1f66", Icon: Bolt, logo: "/icons/providers/ecg.png" },
  water: { label: "Ghana Water", color: "var(--blue)", Icon: Droplet, logo: "/icons/providers/ghana-water.png" },
};

// Same badge treatment as NETWORKS/BILL_PROVIDERS — a color mark, not the
// exam board's actual logo artwork.
export const EXAM_TYPES = {
  bece: { label: "BECE", color: "var(--gold)", initial: "B" },
  wassce: { label: "WASSCE", color: "var(--blue)", initial: "W" },
};

// NOTE: data bundle prices are NOT hardcoded here anymore — they load live
// from Techlink's own catalogue (see pages/data.js + pages/api/techlink/data-bundles.js).
// A static list was removed because bundle prices genuinely change and the
// API itself says "nothing drifts out of sync" when read live.

export function NetworkDot({ id, palette = NETWORKS }) {
  return <span className="dot" style={{ background: palette[id]?.color || "var(--muted-dim)" }} />;
}

// A small brand-colored badge — a network's real color, ECG/Water's real
// color, or an exam board's real color — used wherever a service needs a
// stronger visual mark than plain text. Deliberately not the operator/board's
// actual logo artwork (which is trademarked); this is a same-color icon or
// initial stand-in, the same treatment resale dashboards like Techlink's own
// panel use.
export function NetworkBadge({ id, palette = NETWORKS, size = 22 }) {
  const n = palette[id];
  const [logoFailed, setLogoFailed] = useState(false);
  if (!n) return <NetworkDot id={id} palette={palette} />;

  // Prefer the real provider logo when one has been supplied (drop a file at
  // the path in `logo` — e.g. public/icons/networks/mtn.png) and it loads
  // successfully. Falls back to the color-badge/initial treatment otherwise,
  // so the app never shows a broken image.
  if (n.logo && !logoFailed) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          background: "#fff",
          flexShrink: 0,
        }}
      >
        <img
          src={n.logo}
          alt=""
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={() => setLogoFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: n.color,
        color: "#14151a",
        fontSize: size * 0.42,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {n.Icon ? <n.Icon size={size * 0.58} color="#14151a" /> : (n.initial || n.label?.[0])}
    </span>
  );
}

export function NetworkPicker({ value, onChange, palette = NETWORKS }) {
  return (
    <div className="network-picker">
      {Object.entries(palette).map(([id, n]) => (
        <button
          key={id}
          className={`network-btn ${value === id ? "active" : ""}`}
          onClick={() => onChange(id)}
          style={value === id ? { borderColor: n.color } : undefined}
        >
          <NetworkBadge id={id} palette={palette} size={18} />
          {n.label}
        </button>
      ))}
    </div>
  );
}

// Common Ghana mobile-network prefix ranges used as a customer-safety
// hint before checkout. These are NOT treated as proof of the current
// network because Ghana supports Mobile Number Portability (MNP).
export const NETWORK_PREFIXES = {
  mtn: ["024", "025", "053", "054", "055", "059"],
  telecel: ["020", "050"],
  airteltigo: ["026", "027", "056", "057"],
};

export const AIRTELTIGO_PREFIXES = NETWORK_PREFIXES.airteltigo;

function normalizeGhanaPhone(phone) {
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

// A safety nudge for a network/number mismatch. We deliberately do not
// auto-switch or hard-block because a Ghanaian number may have been ported
// to another operator while keeping the same number.
export function NetworkMismatchNotice({ network, phone, acknowledged, onAcknowledge }) {
  const likely = getLikelyNetwork(phone);
  if (!likely || likely === network) return null;

  const selectedLabel = NETWORKS[network]?.label || network;
  const likelyLabel = NETWORKS[likely]?.label || likely;

  return (
    <div
      style={{
        border: "1px solid var(--red)",
        borderRadius: 8,
        padding: "10px 12px",
        background: "rgba(200, 50, 50, 0.06)",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ color: "var(--red)", fontWeight: 700, marginBottom: 4 }}>
        Check the recipient's network
      </div>
      <div style={{ marginBottom: 7 }}>
        This number starts with a prefix commonly associated with {likelyLabel}, but you selected {selectedLabel}. Please confirm the recipient's current network before paying. Ported numbers can keep their original prefix.
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={Boolean(acknowledged)}
          onChange={(e) => onAcknowledge?.(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>I confirm that this recipient is currently on {selectedLabel}.</span>
      </label>
    </div>
  );
}

// Shown near the phone/account field on every purchase page — Techlink's
// documented rule is that a wrong number is not refunded, so this needs to
// be visible before checkout, not buried in a terms page.
export function NoRefundNotice({ children }) {
  return (
    <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: 0, lineHeight: 1.5 }}>
      {children || "Double-check the number before paying — a wrong number can't be refunded."}
    </p>
  );
}

// The full set of purchase rules — previously only shown on the MTN
// Master/Express/AT/Telecel tier pages (via their "Delivery & selling
// rules" popover); the plain Airtime and Quick Data Top-up pages only ever
// showed the wrong-number line above, missing the outstanding-balance,
// Turbonet/Broadband, and duplicate-order rules entirely.
export function BeforeYouBuyNotice() {
  return (
    <div className="card" style={{ padding: 14, background: "var(--surface-raised)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Before you buy</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--muted-dim)", lineHeight: 1.6 }}>
        <li>Ensure you do not owe any amount on your line before purchasing.</li>
        <li>Turbonet and Broadband SIMs are not eligible.</li>
        <li>Please do not place duplicate orders. Duplicate purchases are non-refundable.</li>
        <li>Double-check the phone number before confirming your purchase. Orders sent to the wrong number are non-refundable.</li>
      </ul>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function EmailField({ email, setEmail }) {
  return (
    <Field label="Your email (for the payment receipt)">
      <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
    </Field>
  );
}

export function PrimaryButton({ children, onClick, disabled, loading }) {
  return (
    <button className="primary-btn" onClick={onClick} disabled={disabled || loading}>
      {loading && <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />}
      {children}
    </button>
  );
}

export function Toast({ toast, duration = 7000 }) {
  const [dismissed, setDismissed] = useState(false);

  // Reset whenever the parent hands us a genuinely new toast (a fresh
  // object from a new setToast({...}) call) — but stays dismissed if the
  // component re-renders with the same toast still in state, so closing it
  // once actually keeps it closed instead of it reappearing.
  useEffect(() => {
    setDismissed(false);
    if (!toast) return undefined;
    const timer = setTimeout(() => setDismissed(true), duration);
    return () => clearTimeout(timer);
  }, [toast, duration]);

  if (!toast || dismissed) return null;
  const ok = toast.type === "success";
  return (
    <div className="toast" style={{ border: `1px solid ${ok ? "var(--green)" : "var(--red)"}` }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: ok ? "var(--green)" : "var(--red)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {ok ? <Check size={13} color="#0d1117" /> : <X size={13} color="#0d1117" />}
      </div>
      <span style={{ fontSize: 14, flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2, flexShrink: 0, display: "flex" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

const FAIL_REASON_LABELS = {
  bundle_unavailable: "Selected data bundle was no longer in the live catalogue at checkout",
  tier_size_unavailable: "Selected bundle size was no longer in Techlink's live catalogue at checkout",
  tier_bulk_row_unavailable: "A bulk order line's bundle size was no longer available at checkout",
  water_amount_unresolved: "Could not resolve a bill amount for that water account",
  tv_amount_unresolved: "Could not resolve an amount due for that smartcard",
  checker_price_unresolved: "Could not resolve a price for that result checker",
  currency_mismatch: "Payment came back in the wrong currency",
  amount_mismatch: "Amount paid didn't match the amount charged",
  payment_abandoned: "Payment was cancelled before completion — no payment was completed.",
};

export const ORDER_TYPE_LABELS = {
  airtime: "Airtime top-up",
  data: "Data bundle",
  tierData: "Data bundle",
  tierBulkData: "Bulk data bundles",
  tierBulkAirtime: "Bulk airtime top-up",
  afa: "AFA registration",
  ecg: "Electricity bill (ECG)",
  water: "Water bill",
  tv: "TV subscription",
  checker: "Result checker",
};

function ReceiptRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, gap: 12 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// The post-purchase confirmation screen — order number, product, amount,
// date/time — shown in place of the checkout form right after a successful
// payment, the way a subscription receipt would. Previously every checkout
// page just flashed a one-line toast for ~1 second and redirected away,
// with no lasting record of what was bought for the customer to see.
export function OrderReceipt({ order, amount, onNewOrder }) {
  if (!order) return null;
  const label = ORDER_TYPE_LABELS[order.orderType] || "Order";
  const when = order.createdAt ? new Date(order.createdAt) : new Date();
  // BUG FIX: this screen used to show the same "Thank you! Your order has
  // been processed." green-checkmark state for EVERY successful checkout,
  // including a queued, non-instant order (e.g. MTN Master — see
  // TIERS.mtnMaster.instant in lib/agentProducts.js), the exact same false
  // "delivered" impression that lib/orderProcessing.js was fixed to stop
  // emailing/texting about. This screen wasn't covered by that fix, even
  // though it's the very first thing the customer sees. OrderList below
  // already branches on fulfillmentStatus for the order-history view —
  // this brings the same honesty to the post-checkout receipt.
  const isQueued = order.fulfillmentStatus === "queued_with_provider";
  // Everything that isn't a confirmed delivery and isn't the known-delayed
  // "queued_with_provider" tier — "processing", "failed", "manual_review",
  // "ready" — now also reaches this screen after the lib/payment.js fix
  // above (payment succeeded, fulfillment is still being retried/reviewed
  // in the background). Bucket all of those as "pending" with an honest,
  // generic message: NEVER claim delivery, and never guess at a specific
  // ETA the way the queued-tier copy does, since these states cover
  // everything from "will auto-retry in a minute" to "needs an admin to
  // top up the Techlink wallet first."
  const isFulfilled = order.fulfillmentStatus === "fulfilled";
  // What the customer actually paid is checkoutAmount (product price + the
  // Paystack processing fee) — prefer that over the bare product `amount`,
  // falling back to the `amount` prop (from the checkout call) for orders
  // that predate the checkoutAmount field.
  const totalPaid = Number(order.checkoutAmount ?? amount ?? order.amount ?? 0);
  const productPrice = Number(order.amount ?? 0);
  const feePaid = order.paystackFeeAmount != null ? Number(order.paystackFeeAmount) : (order.checkoutAmount != null ? Math.round((totalPaid - productPrice) * 100) / 100 : null);
  const showFeeBreakdown = feePaid != null && feePaid > 0;
  const showRecipient = order.phone && order.phone !== "—" && !String(order.phone).includes("recipient");
  return (
    <div className="card" style={{ padding: "32px 28px", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: "50%", background: isFulfilled ? "var(--green)" : "var(--gold)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
        }}
      >
        {isFulfilled ? <Check size={30} color="#fff" /> : <Clock size={28} color="#fff" />}
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{isFulfilled ? "Thank you!" : "Order received — being processed"}</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 24px" }}>
        {isFulfilled
          ? "Your order has been processed."
          : isQueued
            ? "Your payment was successful. This option isn't instant — typically 30 minutes to a few hours (sometimes longer if the queue is busy). This is normal, not an error."
            : "Your payment was successful and your order is being processed now — this can take a few minutes. You do not need to pay again."}
      </p>
      <div
        style={{
          textAlign: "left", display: "flex", flexDirection: "column", gap: 10,
          borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
          padding: "16px 0", marginBottom: 20,
        }}
      >
        <ReceiptRow label="Order number" value={order.reference} />
        <ReceiptRow label="Product" value={label} />
        {showRecipient && <ReceiptRow label="Recipient" value={order.phone} />}
        {showFeeBreakdown ? (
          <>
            <ReceiptRow label="Product price" value={`GHS ${productPrice.toFixed(2)}`} />
            <ReceiptRow label="Payment processing fee" value={`GHS ${feePaid.toFixed(2)}`} />
            <ReceiptRow label="Total paid" value={`GHS ${totalPaid.toFixed(2)}`} />
          </>
        ) : (
          <ReceiptRow label="Amount" value={`GHS ${totalPaid.toFixed(2)}`} />
        )}
        <ReceiptRow label="Date & time" value={when.toLocaleString()} />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-dim)", marginBottom: 20 }}>
        {isFulfilled
          ? "A confirmation has been emailed to you. Keep the order number above for reference."
          : isQueued
            ? "A confirmation email is on its way — we'll email you again once it's actually delivered. Keep the order number above for reference."
            : "If it hasn't arrived within a couple of hours, contact us via the Feedback page with the order number above — no need to pay again."}
      </p>
      <PrimaryButton onClick={onNewOrder}>Make another purchase</PrimaryButton>
    </div>
  );
}

export function OrderList({ items }) {
  const visibleItems = (items || []).filter((o) => o?.failReason !== "payment_abandoned");
  if (visibleItems.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
        No orders yet.
      </div>
    );
  }
  const labelFor = ORDER_TYPE_LABELS;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {visibleItems.map((o) => (
        <div className="tx-row" key={o.reference} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{labelFor[o.orderType] || o.orderType}</div>
                <div style={{ fontSize: 12, color: "var(--muted-dim)", marginTop: 2 }}>
                  {o.phone} · Ref {o.reference} · {new Date(o.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>GHS {Number(o.checkoutAmount ?? o.amount).toFixed(2)}</div>
              <div
                style={{
                  fontSize: 12,
                  color: o.status === "success" ? "var(--green)" : o.failReason === "payment_abandoned" ? "var(--muted)" : o.status === "failed" ? "var(--red)" : o.fulfillmentStatus === "queued_with_provider" ? "var(--gold)" : "var(--muted)",
                }}
              >
                {o.status === "success" ? "Delivered" : o.failReason === "payment_abandoned" ? "Payment cancelled" : o.status === "failed" ? "Failed" : o.fulfillmentStatus === "queued_with_provider" ? "Queued for delivery" : "Payment not completed"}
              </div>
            </div>
          </div>
          {o.fulfillmentStatus === "queued_with_provider" && (
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Typically 30 minutes to a few hours for this option — not an error.</div>
          )}
          {o.status === "failed" && o.failReason && (
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Reason: {FAIL_REASON_LABELS[o.failReason] || o.failReason}</div>
          )}
        </div>
      ))}
    </div>
  );
}
