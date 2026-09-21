import { useEffect, useState } from "react";
import { Field, PrimaryButton, Toast } from "../components/ui";

function Stars({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange && onChange(n)}
          style={{ background: "none", border: "none", cursor: onChange ? "pointer" : "default", fontSize: 26, color: n <= value ? "var(--gold)" : "var(--border)", padding: 0, lineHeight: 1 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [orderReference, setOrderReference] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch("/api/reviews/list").then((r) => r.json()).then((d) => setReviews(d.reviews || []));
  }, []);

  const valid = orderReference.trim() && email.includes("@") && name.trim() && rating > 0;

  function submit() {
    setLoading(true);
    fetch("/api/reviews/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderReference, email, name, rating, comment }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setToast({ type: "error", message: d.error });
        } else {
          setSubmitted(true);
          setReviews((prev) => [d.review, ...prev]);
        }
      })
      .catch(() => setToast({ type: "error", message: "Could not reach the server — try again." }))
      .finally(() => setLoading(false));
  }

  const average = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;

  return (
    <div className="page-wrap" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Customer reviews</h1>
        {average && (
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
            {average} average · {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {!showForm && !submitted && (
        <div style={{ marginBottom: 24 }}>
          <PrimaryButton onClick={() => setShowForm(true)}>Leave a review</PrimaryButton>
        </div>
      )}

      {showForm && !submitted && (
        <div className="card" style={{ padding: 20, marginBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Reviews are tied to a real completed order, so only actual purchasers can leave one.
          </p>
          <Field label="Order reference">
            <input className="input" value={orderReference} onChange={(e) => setOrderReference(e.target.value)} placeholder="TL..." />
          </Field>
          <Field label="Email used at checkout">
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
          </Field>
          <Field label="Your name (shown publicly)">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="How you'd like to appear" />
          </Field>
          <Field label="Rating">
            <Stars value={rating} onChange={setRating} />
          </Field>
          <Field label="Comment (optional)">
            <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was it?" rows={3} style={{ resize: "vertical" }} />
          </Field>
          <PrimaryButton disabled={!valid} loading={loading} onClick={submit}>Submit review</PrimaryButton>
        </div>
      )}

      {submitted && (
        <div className="card" style={{ padding: 20, marginBottom: 24, textAlign: "center", color: "var(--green)" }}>
          Thanks for your review!
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {reviews.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No reviews yet — be the first!</div>}
        {reviews.map((r) => (
          <div key={r.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <strong style={{ fontSize: 14 }}>{r.customerName}</strong>
              <span style={{ fontSize: 12, color: "var(--muted-dim)" }}>{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            <Stars value={r.rating} />
            {r.comment && <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{r.comment}</p>}
          </div>
        ))}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
