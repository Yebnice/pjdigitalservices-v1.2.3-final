import { useEffect, useState } from "react";
import { Field, EmailField, PrimaryButton, Toast, BILL_PROVIDERS, NoRefundNotice, NetworkBadge, OrderReceipt } from "../components/ui";
import { payAndFulfil } from "../lib/payment";
import { withPaystackFee } from "../lib/pricing";

export default function BillsPage() {
  const [provider, setProvider] = useState("ecg");
  const [meterNumber, setMeterNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [receipt, setReceipt] = useState(null);

  // ECG: fraud-prevention lookup before topping up
  const [ecgLookup, setEcgLookup] = useState(null); // { customerName, district } | "error" | null
  const [lookingUp, setLookingUp] = useState(false);

  // Water: fixed bill amount, resolved from Techlink, not typed by the customer
  const [waterBill, setWaterBill] = useState(null); // { accountName, amountDue } | "error" | null
  const [checkingBill, setCheckingBill] = useState(false);

  useEffect(() => {
    setEmail(window.sessionStorage.getItem("pj_email") || "");
    setPhone(window.sessionStorage.getItem("pj_phone") || "");
  }, []);

  useEffect(() => {
    setEcgLookup(null);
    setWaterBill(null);
    setMeterNumber("");
    setAmount("");
  }, [provider]);

  function lookupEcg() {
    setLookingUp(true);
    setEcgLookup(null);
    const params = new URLSearchParams({
      meter: meterNumber,
      phone,
    });
    fetch(`/api/techlink/ecg-lookup?${params.toString()}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, status, data }) => {
        if (!ok) {
          setEcgLookup({ kind: status === 404 ? "not_found" : "unavailable", message: data.error });
        } else {
          setEcgLookup(data);
        }
      })
      .catch(() => setEcgLookup({ kind: "unavailable", message: "ECG lookup is temporarily unavailable. Please try again shortly." }))
      .finally(() => setLookingUp(false));
  }

  function checkWaterBill() {
    setCheckingBill(true);
    setWaterBill(null);
    fetch("/api/techlink/water-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: meterNumber, phone }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, status, data }) => {
        if (!ok) {
          setWaterBill({ kind: status === 404 ? "not_found" : "unavailable", message: data.error });
        } else {
          setWaterBill(data);
        }
      })
      .catch(() => setWaterBill({ kind: "unavailable", message: "Ghana Water validation is temporarily unavailable. Please try again shortly." }))
      .finally(() => setCheckingBill(false));
  }

  const ecgLookupResolved = ecgLookup && !ecgLookup.kind;
  const ecgValid = ecgLookupResolved && meterNumber.length >= 4 && phone.length >= 10 && Number(amount) > 0 && email.includes("@");
  const waterResolved = waterBill && !waterBill.kind;
  const waterValid = waterResolved && phone.length >= 10 && email.includes("@");

  function submit() {
    setLoading(true);
    payAndFulfil({
      orderType: provider,
      phone,
      email,
      meterNumber,
      billAmount: provider === "ecg" ? Number(amount) : undefined,
      onDone: (order, paidAmount) => {
        setLoading(false);
        window.sessionStorage.setItem("pj_email", email);
        window.sessionStorage.setItem("pj_phone", phone);
        setReceipt({ order, amount: paidAmount });
      },
      onError: (msg) => {
        setLoading(false);
        setToast({ type: "error", message: msg });
      },
    });
  }

  if (receipt) {
    return (
      <div className="page-wrap" style={{ maxWidth: 460 }}>
        <OrderReceipt order={receipt.order} amount={receipt.amount} onNewOrder={() => { setReceipt(null); setEcgLookup(null); setWaterBill(null); setMeterNumber(""); setAmount(""); }} />
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 460 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Pay a bill</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>ECG electricity and Ghana Water, paid in one place.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Field label="Provider">
          <div className="network-picker">
            {Object.entries(BILL_PROVIDERS).map(([id, p]) => (
              <button
                key={id}
                className={`network-btn ${provider === id ? "active" : ""}`}
                onClick={() => setProvider(id)}
                style={provider === id ? { borderColor: p.color } : undefined}
              >
                <NetworkBadge id={id} palette={BILL_PROVIDERS} size={18} />
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        {provider === "ecg" && (
          <>
            <Field label="Meter number">
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" style={{ flex: 1 }} value={meterNumber} onChange={(e) => { setMeterNumber(e.target.value); setEcgLookup(null); }} placeholder="e.g. 0210444711" />
                <button className="primary-btn" style={{ width: "auto", padding: "0 16px" }} onClick={lookupEcg} disabled={meterNumber.length < 4 || phone.length < 10 || lookingUp}>
                  {lookingUp ? "..." : "Look up"}
                </button>
              </div>
            </Field>
            {ecgLookup?.kind === "not_found" && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{ecgLookup.message || "No ECG account matched that meter or phone."}</p>}
            {ecgLookup?.kind === "unavailable" && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{ecgLookup.message || "ECG lookup is temporarily unavailable. Please try again shortly."}</p>}
            {ecgLookup && !ecgLookup.kind && (
              <div className="card" style={{ padding: 12, fontSize: 13 }}>
                Meter belongs to <strong>{ecgLookup.customerName}</strong>{ecgLookup.district ? ` · ${ecgLookup.district}` : ""}
              </div>
            )}
            <Field label="Phone number">
              <input className="input" value={phone} onChange={(e) => { setPhone(e.target.value); setEcgLookup(null); setWaterBill(null); }} placeholder="024 000 0000" />
            </Field>
            <Field label="Amount to top up (GHS)">
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" type="number" />
            </Field>
            <EmailField email={email} setEmail={setEmail} />
            <PrimaryButton disabled={!ecgValid} loading={loading} onClick={submit}>
              Pay GHS {(amount ? withPaystackFee(Number(amount)) : 0).toFixed(2)} with Paystack
            </PrimaryButton>
            <p style={{ fontSize: 12, color: "var(--muted-dim)", margin: 0 }}>
              Enter the meter and phone number, then look up the account before paying. This confirms the recipient before the top-up.
            </p>
            <NoRefundNotice />
          </>
        )}

        {provider === "water" && (
          <>
            <Field label="Ghana Water account / meter number">
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" style={{ flex: 1 }} value={meterNumber} onChange={(e) => { setMeterNumber(e.target.value); setWaterBill(null); }} placeholder="e.g. 0500123456" />
                <button className="primary-btn" style={{ width: "auto", padding: "0 16px" }} onClick={checkWaterBill} disabled={meterNumber.length < 4 || checkingBill}>
                  {checkingBill ? "..." : "Check bill"}
                </button>
              </div>
            </Field>
            {waterBill?.kind === "not_found" && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{waterBill.message || "No Ghana Water account matched that number."}</p>}
            {waterBill?.kind === "unavailable" && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{waterBill.message || "Ghana Water validation is temporarily unavailable. Please try again shortly."}</p>}
            {waterResolved && (
              <div className="card" style={{ padding: 12, fontSize: 13 }}>
                <div><strong>{waterBill.accountName || waterBill.customerName}</strong></div>
                <div style={{ marginTop: 4 }}>Amount due: <strong>GHS {Number(waterBill.balance ?? waterBill.amountDue ?? waterBill.amount).toFixed(2)}</strong></div>
              </div>
            )}
            <Field label="Phone number">
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 000 0000" />
            </Field>
            <EmailField email={email} setEmail={setEmail} />
            <PrimaryButton disabled={!waterValid} loading={loading} onClick={submit}>
              {waterBill && waterBill !== "error"
                ? `Pay GHS ${withPaystackFee(Number(waterBill.balance ?? waterBill.amountDue ?? waterBill.amount)).toFixed(2)} with Paystack`
                : "Check your bill first"}
            </PrimaryButton>
            <NoRefundNotice />
          </>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
