import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Field, EmailField, PrimaryButton, Toast } from "../components/ui";
import { payAndFulfil } from "../lib/payment";

export default function CheckerPage() {
  const router = useRouter();
  const [mode, setMode] = useState("voucher"); // "voucher" | "lookup"
  const [type, setType] = useState("BECE");
  const [quantity, setQuantity] = useState(1);
  const [deliveryMethod, setDeliveryMethod] = useState("email");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [indexNumber, setIndexNumber] = useState("");
  const [examYear, setExamYear] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setEmail(window.localStorage.getItem("pj_email") || "");
    setPhone(window.localStorage.getItem("pj_phone") || "");
  }, []);

  const voucherValid = email.includes("@") && (deliveryMethod === "email" || phone.length >= 10);
  const lookupValid = indexNumber && examYear && email.includes("@");
  const valid = mode === "voucher" ? voucherValid : lookupValid;

  function submit() {
    setLoading(true);
    payAndFulfil({
      orderType: "checker",
      phone: phone || "N/A",
      email,
      checkerDetails:
        mode === "voucher"
          ? { mode: "voucher", type, quantity, deliveryMethod }
          : { mode: "lookup", type: type.toLowerCase(), indexNumber, examYear, candidateName },
      onDone: () => {
        setLoading(false);
        window.localStorage.setItem("pj_email", email);
        if (phone) window.localStorage.setItem("pj_phone", phone);
        setToast({
          type: "success",
          message: mode === "voucher" ? "Voucher purchased — check your inbox/SMS." : "Request received — we'll email your result once it's ready.",
        });
        setTimeout(() => router.push("/dashboard"), 1400);
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
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Result checker</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>BECE and WASSCE, self-service voucher or done for you.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Field label="What do you need?">
          <div className="network-picker">
            <button className={`network-btn ${mode === "voucher" ? "active" : ""}`} onClick={() => setMode("voucher")}>Buy a voucher</button>
            <button className={`network-btn ${mode === "lookup" ? "active" : ""}`} onClick={() => setMode("lookup")}>Check it for me</button>
          </div>
        </Field>

        <Field label="Exam">
          <div className="network-picker">
            <button className={`network-btn ${type === "BECE" ? "active" : ""}`} onClick={() => setType("BECE")}>BECE</button>
            <button className={`network-btn ${type === "WASSCE" ? "active" : ""}`} onClick={() => setType("WASSCE")}>WASSCE</button>
          </div>
        </Field>

        {mode === "voucher" && (
          <>
            <Field label="How many?">
              <input className="input" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} style={{ maxWidth: 120 }} />
            </Field>
            <Field label="Send the voucher via">
              <div className="network-picker">
                <button className={`network-btn ${deliveryMethod === "email" ? "active" : ""}`} onClick={() => setDeliveryMethod("email")}>Email</button>
                <button className={`network-btn ${deliveryMethod === "sms" ? "active" : ""}`} onClick={() => setDeliveryMethod("sms")}>SMS</button>
              </div>
            </Field>
            {deliveryMethod === "sms" && (
              <Field label="Phone number">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 000 0000" />
              </Field>
            )}
            <EmailField email={email} setEmail={setEmail} />
          </>
        )}

        {mode === "lookup" && (
          <>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              Not instant — we look this up and email the result once it's ready.
            </p>
            <Field label="Index number">
              <input className="input" value={indexNumber} onChange={(e) => setIndexNumber(e.target.value)} placeholder="e.g. 0123456789" />
            </Field>
            <Field label="Exam year">
              <input className="input" value={examYear} onChange={(e) => setExamYear(e.target.value)} placeholder="e.g. 2025" />
            </Field>
            <Field label="Candidate name (optional)">
              <input className="input" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder="As registered" />
            </Field>
            <EmailField email={email} setEmail={setEmail} />
          </>
        )}

        <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>
          {mode === "voucher" ? "Pay & get voucher" : "Pay & request check"}
        </PrimaryButton>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
