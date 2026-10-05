import { useEffect, useState } from "react";
import Link from "next/link";
import { OrderList } from "../components/ui";
import { isAbandonedOrder } from "../lib/orderStatus";

function customerVisibleOrders(items) {
  return (items || []).filter((o) => !isAbandonedOrder(o));
}

export default function DashboardPage() {
  const [customer, setCustomer] = useState(undefined); // undefined = checking, null = guest
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Logged-in customers see every order tied to their account automatically
  // — previously this page only supported looking up one order at a time
  // by reference + email, even for someone with a real account.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.customer) {
          setCustomer(d.customer);
          loadMine();
        } else {
          setCustomer(null);
        }
      })
      .catch(() => setCustomer(null));
  }, []);

  useEffect(() => {
    if (customer === null) {
      try {
        setReference(window.localStorage.getItem("pj_last_reference") || "");
        setEmail(window.sessionStorage.getItem("pj_email") || "");
      } catch {}
    }
  }, [customer]);

  useEffect(() => { if (customer === null && reference && email) loadOne(); }, [customer, reference, email]);

  async function loadMine() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/orders/my");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load your orders");
      setOrders(customerVisibleOrders(d.orders));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function loadOne() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load your order");
      const visible = customerVisibleOrders(d.orders);
      const abandoned = (d.orders || []).find((o) => isAbandonedOrder(o));
      if (abandoned && visible.length === 0) {
        try {
          window.localStorage.removeItem("pj_last_reference");
        } catch {}
        setReference("");
        setOrders(null);
      } else {
        setOrders(visible);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const processing = (orders || []).filter((o) => ["payment_verified"].includes(o.status) || ["ready", "processing", "manual_review", "queued_with_provider"].includes(o.fulfillmentStatus));

  if (customer === undefined) return null;

  if (customer) {
    return (
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>My orders</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Signed in as <strong style={{ color: "var(--text)" }}>{customer.username || customer.name}</strong> · every order placed with {customer.email}{orders ? ` · ${orders.length} order${orders.length === 1 ? "" : "s"}` : ""}.</p>
        </div>
        {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p>}
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        {processing.length > 0 && <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 13, borderColor: "var(--gold)" }}>One or more paid orders are still being processed. Refresh later to see the latest status.</div>}
        {orders && <OrderList items={orders} />}
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>My order</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Use your order number (or Paystack reference) and the checkout email to view one order securely.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
        <input id="order-reference" name="reference" aria-label="Order reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Order number or reference" />
        <input id="order-email" name="email" aria-label="Checkout email" autoComplete="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Checkout email" />
      </div>
      <button className="primary-btn" onClick={loadOne} disabled={!reference || !email.includes("@") || loading}>{loading ? "Checking…" : "Check order"}</button>
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      {orders && <>
        {processing.length > 0 && <div className="card" style={{ padding: 12, margin: "16px 0", fontSize: 13, borderColor: "var(--gold)" }}>Your paid order is still being processed. We are sorry for the delay. Please do not place a duplicate order; refresh this page later to see the latest status.</div>}
        <OrderList items={orders} />
      </>}
      {!reference && (
        <p style={{ fontSize: 13, color: "var(--muted-dim)", marginTop: 16 }}>
          After a successful payment, your last order number is saved on this device. You can also find it on your receipt and in your confirmation email.{" "}
          <Link href="/track" style={{ color: "var(--price)" }}>Track an order</Link>, or{" "}
          <Link href="/login" style={{ color: "var(--price)" }}>log in</Link> to see all your orders at once.
        </p>
      )}
    </div>
  );
}
