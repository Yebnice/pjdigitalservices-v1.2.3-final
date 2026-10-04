import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../lib/adminClient";
import { Banner, EmptyState } from "./AdminUi";

export default function ReviewsTab({ can, refreshTick, onUnauthorized }) {
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    adminApi("/api/admin/reviews", { onUnauthorized })
      .then((d) => { setReviews(d.reviews || []); setError(""); })
      .catch((err) => setError(err.message));
  }, [onUnauthorized]);

  useEffect(() => { load(); }, [load, refreshTick]);

  async function toggle(review) {
    try {
      await adminApi("/api/admin/reviews", { method: "POST", body: { id: review.id, isHidden: !review.isHidden }, onUnauthorized });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <Banner tone="amber">{error}</Banner>}
      <div className="card" style={{ overflow: "hidden" }}>
        {reviews && reviews.length === 0 && <EmptyState>No reviews yet.</EmptyState>}
        {!reviews && !error && <EmptyState>Loading reviews…</EmptyState>}
        {(reviews || []).map((r) => (
          <div key={r.id} className="tx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, opacity: r.isHidden ? 0.5 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <strong style={{ fontSize: 14 }}>{r.customerName} — {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</strong>
              {can("reviews.moderate") && (
                <button className="nav-item" style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} onClick={() => toggle(r)}>{r.isHidden ? "Unhide" : "Hide"}</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>Order {r.orderReference} · {r.serviceType} · {new Date(r.createdAt).toLocaleString()}</div>
            {r.comment && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.comment}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
