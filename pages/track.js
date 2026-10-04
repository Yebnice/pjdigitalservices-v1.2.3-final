import { useEffect, useState } from "react";
import { Field, PrimaryButton } from "../components/ui";
import OrdersTable from "../components/OrdersTable";

export default function TrackPage() {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setReference(window.localStorage.getItem("pj_last_reference") || "");
      setEmail(window.sessionStorage.getItem("pj_email") || "");
    } catch {}
  }, []);

  async function search() {
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not find the order");
      setResults(d.orders);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Track your order</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>For privacy, enter your order number (or Paystack reference) and the email you used when paying.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
        <Field label="Order number or reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="PJ-XXXXXXXX or TL…" /></Field>
        <Field label="Checkout email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="you@example.com" /></Field>
        <PrimaryButton onClick={search} disabled={!reference.trim() || !email.includes("@")} loading={loading}>Check order</PrimaryButton>
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        </div>
        {results && <div style={{ marginTop: 8 }}><div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Order status</div>{results.some((o) => ["ready", "processing", "manual_review", "failed"].includes(o.fulfillmentStatus)) && <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 13, borderColor: "var(--gold)" }}>Your order is still being processed. We are sorry for the delay. Please do not place a duplicate order while we complete the request.</div>}<OrdersTable items={results} /></div>}
      </div>
    </div>
  );
}
