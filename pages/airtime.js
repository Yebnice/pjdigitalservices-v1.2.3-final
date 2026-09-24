import { useEffect, useState } from "react";
import { NetworkPicker, Field, EmailField, PrimaryButton, Toast, OrderReceipt, NetworkMismatchNotice, getLikelyNetwork } from "../components/ui";
import { payAndFulfil } from "../lib/payment";
import { withPaystackFee } from "../lib/pricing";

export default function AirtimePage() {
  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [networkConfirmed, setNetworkConfirmed] = useState(false);

  useEffect(() => {
    setEmail(window.sessionStorage.getItem("pj_email") || "");
    setPhone(window.sessionStorage.getItem("pj_phone") || "");
  }, []);

  const likelyNetwork = getLikelyNetwork(phone);
  const networkMismatch = Boolean(likelyNetwork && likelyNetwork !== network);
  const valid = phone.length >= 10 && Number(amount) > 0 && email.includes("@") && (!networkMismatch || networkConfirmed);

  function submit() {
    setLoading(true);
    payAndFulfil({
      orderType: "airtime",
      network,
      phone,
      email,
      airtimeAmount: Number(amount),
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
        <OrderReceipt order={receipt.order} amount={receipt.amount} onNewOrder={() => { setReceipt(null); setAmount(""); }} />
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 460 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Buy airtime</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>Pay by card, mobile money or bank — instant delivery, all networks.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Field label="Network"><NetworkPicker value={network} onChange={(value) => { setNetwork(value); setNetworkConfirmed(false); }} /></Field>
        <Field label="Recipient phone number">
          <input className="input" value={phone} onChange={(e) => { setPhone(e.target.value); setNetworkConfirmed(false); }} placeholder="024 000 0000" />
        </Field>
        <NetworkMismatchNotice network={network} phone={phone} acknowledged={networkConfirmed} onAcknowledge={setNetworkConfirmed} />
        <Field label="Amount (GHS)">
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10.00" type="number" />
        </Field>
        <EmailField email={email} setEmail={setEmail} />
        <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>
          Pay GHS {(amount ? withPaystackFee(Number(amount)) : 0).toFixed(2)} with Paystack
        </PrimaryButton>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
