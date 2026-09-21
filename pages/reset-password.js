import { useState } from "react";
import { useRouter } from "next/router";
import { Field, PrimaryButton } from "../components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const valid = password.length >= 8 && password === confirmPassword;

  function submit() {
    setLoading(true);
    setError("");
    fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: router.query.token, password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) setDone(true);
        else setError(d.error);
      })
      .catch(() => setError("Could not reach the server — try again."))
      .finally(() => setLoading(false));
  }

  if (done) {
    return (
      <div className="page-wrap" style={{ maxWidth: 380 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Password updated</h1>
        <PrimaryButton onClick={() => router.push("/login")}>Go to login</PrimaryButton>
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 380 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 20px" }}>Choose a new password</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="New password">
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <input className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Retype your password" type="password" autoComplete="new-password" />
        </Field>
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p style={{ fontSize: 12, color: "var(--red)", margin: "-8px 0 0" }}>Passwords don't match.</p>
        )}
        <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>
          Update password
        </PrimaryButton>
        {error && <p style={{ fontSize: 13, color: "var(--red)" }}>{error}</p>}
      </div>
    </div>
  );
}
