import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { OrderList } from "../../components/ui";
import { isAbandonedOrder } from "../../lib/orderStatus";

function customerVisibleOrders(items) {
  return (items || []).filter((o) => !isAbandonedOrder(o));
}

export default function CustomerOrdersPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState(undefined);
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = await fetch("/api/auth/me").then((r) => r.json());
        if (!active) return;
        if (!me.customer) {
          setCustomer(null);
          router.replace("/login?next=/dashboard/orders");
          return;
        }
        setCustomer(me.customer);
        const r = await fetch("/api/orders/my");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load your orders");
        if (!active) return;
        setOrders(customerVisibleOrders(d.orders));
      } catch (err) {
        if (!active) return;
        setError(err.message || "Could not load your orders");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  if (customer === undefined && loading) return null;
  if (!customer) return null;

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>My Orders</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
            All orders linked to {customer.email}.
          </p>
        </div>
        <Link href="/dashboard" style={{ color: "var(--price)", fontSize: 13 }}>← Back to dashboard</Link>
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading your orders…</p>}
      {!loading && orders && orders.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          No completed or active orders are linked to this account yet.
        </div>
      )}
      {!loading && orders && orders.length > 0 && <OrderList items={orders} />}
    </div>
  );
}
