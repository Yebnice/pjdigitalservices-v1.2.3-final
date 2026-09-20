import { useState } from "react";
import { Loader2, Check, X, Bolt, Droplet, GraduationCap } from "lucide-react";

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

// Confirmed from Techlink's own AT iShare selling-rules panel: only these
// prefixes are AirtelTigo numbers. A wrong number is NOT refundable per
// their rules, so catching an obviously-wrong prefix before checkout
// protects you from an unrecoverable loss.
export const AIRTELTIGO_PREFIXES = ["026", "056", "027", "057", "023", "053"];

export function isLikelyAirtelTigoNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  const local = digits.startsWith("233") ? "0" + digits.slice(3) : digits; // handle +233 entry
  return AIRTELTIGO_PREFIXES.some((p) => local.startsWith(p));
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

export function Toast({ toast }) {
  if (!toast) return null;
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
      <span style={{ fontSize: 14 }}>{toast.message}</span>
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
  const displayAmount = Number(order.amount ?? amount ?? 0);
  const showRecipient = order.phone && order.phone !== "—" && !String(order.phone).includes("recipient");
  return (
    <div className="card" style={{ padding: "32px 28px", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: "50%", background: "var(--green)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
        }}
      >
        <Check size={30} color="#fff" />
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Thank you!</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 24px" }}>Your order has been processed.</p>
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
        <ReceiptRow label="Amount" value={`GHS ${displayAmount.toFixed(2)}`} />
        <ReceiptRow label="Date & time" value={when.toLocaleString()} />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-dim)", marginBottom: 20 }}>
        A confirmation has been emailed to you. Keep the order number above for reference.
      </p>
      <PrimaryButton onClick={onNewOrder}>Make another purchase</PrimaryButton>
    </div>
  );
}

export function OrderList({ items }) {
  if (!items || items.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
        No orders yet.
      </div>
    );
  }
  const labelFor = ORDER_TYPE_LABELS;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {items.map((o) => (
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
              <div style={{ fontSize: 14, fontWeight: 600 }}>GHS {Number(o.amount).toFixed(2)}</div>
              <div
                style={{
                  fontSize: 12,
                  color: o.status === "success" ? "var(--green)" : o.status === "failed" ? "var(--red)" : "var(--muted)",
                }}
              >
                {o.status === "success" ? "Delivered" : o.status === "failed" ? "Failed" : "Pending"}
              </div>
            </div>
          </div>
          {o.status === "failed" && o.failReason && (
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Reason: {FAIL_REASON_LABELS[o.failReason] || o.failReason}</div>
          )}
        </div>
      ))}
    </div>
  );
}
