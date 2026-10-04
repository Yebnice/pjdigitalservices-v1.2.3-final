import { useCallback, useEffect, useState } from "react";
import { Banner, DataTable, EmptyState, MONO, TD } from "./AdminUi";
import { adminApi, whenText } from "../../lib/adminClient";

const COLUMNS = [
  { key: "when", label: "Date" },
  { key: "who", label: "Customer" },
  { key: "rating", label: "Rating" },
  { key: "order", label: "Order" },
  { key: "service", label: "Service" },
  { key: "comment", label: "Comment" },
  { key: "show", label: "Shown on site" },
];

export default function ReviewsTab({ can, refreshTick, onUnauthorized }) {
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    adminApi("/api/admin/reviews", { onUnauthorized }).then((d) => { setReviews(d.reviews || []); setError(""); }).catch((err) => setError(err.message));
  }, [onUnauthorized]);
  useEffect(() => { load(); }, [load, refreshTick]);

  async function toggle(r) {
    try {
      await adminApi("/api/admin/reviews", { method: "POST", body: { id: r.id, isHidden: !r.isHidden }, onUnauthorized });
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
        {reviews && reviews.length > 0 && (
          <DataTable columns={COLUMNS} minWidth={900}>
            {reviews.map((r) => (
              <tr key={r.id} style={{ opacity: r.isHidden ? 0.55 : 1 }}>
                <td style={{ ...TD, whiteSpace: "nowrap" }}>{whenText(r.createdAt)}</td>
                <td style={{ ...TD, fontWeight: 600 }}>{r.customerName}</td>
                <td style={{ ...TD, whiteSpace: "nowrap", color: "#b45309" }} aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</td>
                <td style={TD}><span style={MONO}>{r.orderReference}</span></td>
                <td style={TD}>{r.serviceType}</td>
                <td style={{ ...TD, maxWidth: 360, wordBreak: "break-word", color: "var(--muted)" }}>{r.comment || "—"}</td>
                <td style={TD}>
                  {can("reviews.moderate")
                    ? <button className="nav-item" style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} onClick={() => toggle(r)}>{r.isHidden ? "Hidden. Show" : "Shown. Hide"}</button>
                    : (r.isHidden ? "Hidden" : "Shown")}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}
