import { useState } from "react";
import { useRouter } from "next/router";
import { Field, PrimaryButton } from "../components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [done, setDone] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const valid =
    name.trim().length > 1 &&
    /^[a-z0-9_.]{3,20}$/i.test(username) &&
    email.includes("@") &&
    phone.length >= 10 &&
    password.length >= 8 &&
    password === confirmPassword;

  function submit() {
    setLoading(true);
    setMessage(null);
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, email, phone, password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setMessage({ type: "error", text: d.error });
        } else {
          setDone(true);
        }
      })
      .catch(() => setMessage({ type: "error", text: "Could not reach the server — try again." }))
      .finally(() => setLoading(false));
  }

  if (done) {
    return (
      <div className="page-wrap" style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Almost there!</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          We've sent a verification link to <strong>{email}</strong>. Click it to activate your account,
          then come back and log in.
        </p>
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <PrimaryButton onClick={() => router.push("/login")}>Go to login</PrimaryButton>
          <button
            type="button"
            disabled={resending}
            onClick={() => {
              setResending(true);
              setResendMessage("");
              fetch("/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
              })
                .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                .then(({ d }) => setResendMessage(d.message || "If an unverified account exists, a new verification link has been sent."))
                .catch(() => setResendMessage("We could not process that request right now. Please try again shortly."))
                .finally(() => setResending(false));
            }}
            style={{ background: "none", border: 0, padding: 8, color: "var(--muted)", cursor: resending ? "wait" : "pointer" }}
          >
            {resending ? "Sending…" : "Didn't receive the email? Send again"}
          </button>
          {resendMessage && <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{resendMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 420 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Create an account</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
          A real account with a password — faster checkout, order history, and you can leave reviews on your purchases.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Full name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourname" autoCapitalize="none" />
        </Field>
        {username.length > 0 && !/^[a-z0-9_.]{3,20}$/i.test(username) && (
          <p style={{ fontSize: 12, color: "var(--red)", margin: "-8px 0 0" }}>3–20 characters: letters, numbers, dots, or underscores only.</p>
        )}
        <Field label="Email">
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
        </Field>
        <Field label="Phone number">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 000 0000" />
        </Field>
        <Field label="Password">
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Retype your password" type="password" autoComplete="new-password" />
        </Field>
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p style={{ fontSize: 12, color: "var(--red)", margin: "-8px 0 0" }}>Passwords don't match.</p>
        )}
        <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>
          Create account
        </PrimaryButton>
        {message && <p style={{ fontSize: 13, color: "var(--red)" }}>{message.text}</p>}
        <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginTop: 4 }}>
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>
  );
}
