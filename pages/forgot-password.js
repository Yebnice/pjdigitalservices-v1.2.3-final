import { useState } from "react";
import { Field, PrimaryButton } from "../components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  function submit() {
    setLoading(true);
    fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then(() => setSent(true))
      .finally(() => setLoading(false));
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 380 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Reset your password</h1>
      {sent ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          If an account exists with that email, we've sent a reset link — check your inbox.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Email">
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
          </Field>
          <PrimaryButton disabled={!email.includes("@")} loading={loading} onClick={submit}>
            Send reset link
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
