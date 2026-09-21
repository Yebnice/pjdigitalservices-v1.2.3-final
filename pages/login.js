import { useState } from "react";
import { useRouter } from "next/router";
import { Field, PrimaryButton } from "../components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    setLoading(true);
    setError("");
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setError(d.error);
        } else {
          router.push("/dashboard");
        }
      })
      .catch(() => setError("Could not reach the server — try again."))
      .finally(() => setLoading(false));
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 380 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 20px" }}>Log in</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Email or username">
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Your password" type="password" autoComplete="current-password" />
        </Field>
        <PrimaryButton disabled={!identifier || !password} loading={loading} onClick={submit}>
          Log in
        </PrimaryButton>
        {error && <p style={{ fontSize: 13, color: "var(--red)" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <a href="/register">Create an account</a>
          <a href="/forgot-password">Forgot password?</a>
        </div>
      </div>
    </div>
  );
}
