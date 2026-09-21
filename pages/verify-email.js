import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { PrimaryButton } from "../components/ui";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | ok | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    const token = router.query.token;
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) setStatus("ok");
        else {
          setStatus("error");
          setError(d.error);
        }
      })
      .catch(() => {
        setStatus("error");
        setError("Could not reach the server — try again.");
      });
  }, [router.isReady, router.query.token]);

  return (
    <div className="page-wrap" style={{ maxWidth: 420, textAlign: "center" }}>
      {status === "checking" && <p style={{ color: "var(--muted)" }}>Verifying your email…</p>}
      {status === "ok" && (
        <>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Email verified!</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>Your account is active — you can log in now.</p>
          <PrimaryButton onClick={() => router.push("/login")}>Go to login</PrimaryButton>
        </>
      )}
      {status === "error" && (
        <>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Link expired or invalid</h1>
          <p style={{ color: "var(--red)", fontSize: 14 }}>{error}</p>
        </>
      )}
    </div>
  );
}
