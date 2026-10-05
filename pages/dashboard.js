import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Clock3, CheckCircle2, ShoppingCart, Smartphone, Wifi, Bolt, Headset } from "lucide-react";
import { useRouter } from "next/router";
import { OrderList } from "../components/ui";
import { isAbandonedOrder } from "../lib/orderStatus";

function customerVisibleOrders(items) {
  return (items || []).filter((o) => !isAbandonedOrder(o));
}

function StatCard({ icon: Icon, label, value, href }) {
  const body = (
    <div className="stat-card" style={{ display: "flex", alignItems: "center", gap: 12, height: "100%" }}>
      <div className="service-icon"><Icon size={17} color="var(--blue-light)" /></div>
      <div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : body;
}

const QUICK_ACTIONS = [
  { href: "/airtime", label: "Buy Airtime", icon: Smartphone },
  { href: "/data", label: "Buy Quick Data", icon: Wifi },
  { href: "/bills", label: "Pay Bills", icon: Bolt },
  { href: "/feedback", label: "Get Support", icon: Headset },
];

export default function DashboardPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState(undefined);
  const [orders, setOrders] = useState([]);
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
          router.replace("/login?next=/dashboard");
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
        setError(err.message || "Could not load your dashboard");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  const recentOrders = orders.slice(0, 5);
  const processing = useMemo(
    () => orders.filter((o) => o.status === "payment_verified" || ["ready", "processing", "manual_review", "queued_with_provider"].includes(o.fulfillmentStatus)),
    [orders]
  );
  const completed = useMemo(() => orders.filter((o) => o.fulfilled || o.status === "success"), [orders]);

  if (customer === undefined && loading) return null;
  if (!customer) return null;

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <section className="card" style={{ padding: 22, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Customer dashboard</div>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: "6px 0 4px" }}>Welcome, {customer.name || customer.username}</h1>
            <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
              {customer.email} · Your purchases, order status and account shortcuts in one place.
            </p>
          </div>
          <Link href="/dashboard/orders" className="primary-btn" style={{ width: "auto", padding: "10px 14px", textDecoration: "none" }}>
            <ClipboardList size={16} />
            View all orders
          </Link>
        </div>
      </section>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard icon={ClipboardList} label="Total orders" value={orders.length} href="/dashboard/orders" />
        <StatCard icon={Clock3} label="Processing" value={processing.length} href="/dashboard/orders" />
        <StatCard icon={CheckCircle2} label="Completed" value={completed.length} href="/dashboard/orders" />
      </section>

      <section style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 18, margin: 0 }}>Recent orders</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Your latest purchases and delivery status.</p>
          </div>
          {orders.length > 5 && <Link href="/dashboard/orders" style={{ color: "var(--price)", fontSize: 13 }}>See all</Link>}
        </div>
        {loading ? (
          <div className="card" style={{ padding: 18, color: "var(--muted)", fontSize: 14 }}>Loading your orders…</div>
        ) : recentOrders.length > 0 ? (
          <OrderList items={recentOrders} />
        ) : (
          <div className="card" style={{ padding: 22, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            You have not placed an order with this account yet.
          </div>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Quick actions</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, textDecoration: "none", color: "inherit" }}>
              <div className="service-icon"><Icon size={16} color="var(--blue-light)" /></div>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div className="service-icon"><ShoppingCart size={16} color="var(--blue-light)" /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Bought without logging in?</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)", margin: "4px 0 0" }}>
              Use the public <Link href="/track" style={{ color: "var(--price)" }}>Track an Order</Link> page with your order number and checkout email. Logged-in orders stay here in your account.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
