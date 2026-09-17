import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Field, EmailField, PrimaryButton, Toast, NoRefundNotice } from "../components/ui";
import { payAndFulfil } from "../lib/payment";

const PROVIDERS = { DSTV: "DSTV", GOTV: "GOtv", STARTIMES: "StarTimes" };

export default function TvPage() {
  const router = useRouter();
  const [service, setService] = useState("DSTV");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const [validation, setValidation] = useState(null); // { customerName, package, amountDue } | "error" | null
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    setEmail(window.localStorage.getItem("pj_email") || "");
    setPhone(window.localStorage.getItem("pj_phone") || "");
  }, []);

  useEffect(() => {
    setValidation(null);
    setAccount("");
  }, [service]);

  function validate() {
    setValidating(true);
    setValidation(null);
    fetch("/api/techlink/tv-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billType: service, account }),
    })
      .then((r) => r.json())
      .then((d) => setValidation(d.error ? "error" : d))
      .catch(() => setValidation("error"))
      .finally(() => setValidating(false));
  }

  const valid = validation && validation !== "error" && phone.length >= 10 && email.includes("@");

  function submit() {
    setLoading(true);
    payAndFulfil({
      orderType: "tv",
      phone,
      email,
      meterNumber: account,
      tvDetails: { service },
      onDone: () => {
        setLoading(false);
        window.localStorage.setItem("pj_email", email);
        window.localStorage.setItem("pj_phone", phone);
        setToast({ type: "success", message: "Subscription payment submitted" });
        setTimeout(() => router.push("/dashboard"), 1200);
      },
      onError: (msg) => {
        setLoading(false);
        setToast({ type: "error", message: msg });
      },
    });
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 460 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>TV subscription</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>DSTV, GOtv and StarTimes.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Field label="Provider">
          <div className="network-picker">
            {Object.entries(PROVIDERS).map(([id, label]) => (
              <button
                key={id}
                className={`network-btn ${service === id ? "active" : ""}`}
                onClick={() => setService(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Smartcard / account number">
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. 7020000004" />
            <button className="primary-btn" style={{ width: "auto", padding: "0 16px" }} onClick={validate} disabled={account.length < 4 || validating}>
              {validating ? "..." : "Check"}
            </button>
          </div>
        </Field>
        {validation === "error" && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>Could not find that smartcard — double-check the number.</p>}
        {validation && validation !== "error" && (
          <div className="card" style={{ padding: 12, fontSize: 13 }}>
            <div><strong>{validation.customerName}</strong>{validation.package ? ` · ${validation.package}` : ""}</div>
            <div style={{ marginTop: 4 }}>Amount due: <strong>GHS {Number(validation.amountDue ?? validation.amount).toFixed(2)}</strong></div>
          </div>
        )}
        <Field label="Phone number">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 000 0000" />
        </Field>
        <EmailField email={email} setEmail={setEmail} />
        <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>
          {validation && validation !== "error"
            ? `Pay GHS ${Number(validation.amountDue ?? validation.amount).toFixed(2)} with Paystack`
            : "Check your smartcard first"}
        </PrimaryButton>
        <NoRefundNotice />
      </div>
      <Toast toast={toast} />
    </div>
  );
}
