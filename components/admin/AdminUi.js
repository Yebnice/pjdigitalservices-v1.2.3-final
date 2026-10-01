import { useEffect, useState } from "react";
import { TONE_COLORS } from "../../lib/adminClient";

export function TabButton({ active, onClick, children, badge }) {
  return (
    <button
      className="nav-item"
      style={{ width: "auto", padding: "6px 12px", background: active ? "var(--surface-raised)" : "transparent", borderColor: "var(--line)", fontWeight: active ? 600 : 400 }}
      onClick={onClick}
    >
      {children}
      {badge ? <span style={{ marginLeft: 6, background: "#dc2626", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{badge}</span> : null}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder, style }) {
  return (
    <input name="search" aria-label={placeholder || "Search"} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ maxWidth: 360, ...style }} />
  );
}

export function StatCard({ label, value, tone, hint }) {
  return (
    <div className="stat-card" title={hint || undefined}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{label}</div>
      <div className="heading-font" style={{ fontSize: 22, fontWeight: 600, color: tone ? TONE_COLORS[tone] || tone : undefined }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: "var(--muted-dim)", marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

const BANNER = {
  red: { background: "#fee2e2", border: "#ef4444", color: "#991b1b" },
  amber: { background: "#fef3c7", border: "#f59e0b", color: "#92400e" },
  blue: { background: "#dbeafe", border: "#60a5fa", color: "#1e3a8a" },
};

export function Banner({ tone = "amber", children, action }) {
  const c = BANNER[tone] || BANNER.amber;
  return (
    <div style={{ background: c.background, border: `1px solid ${c.border}`, color: c.color, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function StatusPill({ text, tone = "muted" }) {
  const color = TONE_COLORS[tone] || TONE_COLORS.muted;
  return <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 10, padding: "1px 8px", whiteSpace: "nowrap" }}>{text}</span>;
}

export function EmptyState({ children }) {
  return <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{children}</div>;
}

// Hand-rolled SVG bars: there is no charting library in package.json and a
// handful of bars is not worth adding one.
export function BarChart({ points, format }) {
  if (!points.length || points.every((p) => !p.value)) return <EmptyState>No delivered orders in this range yet.</EmptyState>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 640, h = 160, padBottom = 22, gap = 4;
  const step = w / points.length;
  const barW = Math.max(2, step - gap);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 160, display: "block" }} preserveAspectRatio="none" role="img" aria-label="Sales per day">
      {points.map((p, i) => {
        const barH = ((h - padBottom) * p.value) / max;
        const x = i * step;
        return (
          <g key={p.key}>
            <rect x={x} y={h - padBottom - barH} width={barW} height={Math.max(barH, p.value > 0 ? 2 : 0)} fill="var(--accent, #2563eb)" rx="2">
              <title>{`${p.label}: ${format ? format(p.value) : p.value}`}</title>
            </rect>
            {(points.length <= 10 || i % Math.ceil(points.length / 8) === 0) && (
              <text x={x + barW / 2} y={h - 6} fontSize="9" fill="var(--muted-dim)" textAnchor="middle">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// A proper confirmation dialog for actions that need an audit note. The old
// window.prompt() silently did nothing when the note was under 5 characters.
export function NoteDialog({ open, title, message, warning, confirmLabel = "Confirm", danger, options = [], onConfirm, onCancel }) {
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState({});
  useEffect(() => {
    if (open) {
      setNote("");
      setPicked(Object.fromEntries(options.map((o) => [o.key, o.defaultChecked !== false])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const ok = note.trim().length >= 5;
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="card" style={{ padding: 20, maxWidth: 480, width: "100%", background: "var(--surface, #fff)", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.5 }}>{message}</p>
        {warning && <p style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px", margin: "0 0 10px", lineHeight: 1.5 }}>{warning}</p>}
        <textarea id="audit-note" name="note" aria-label="Audit note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (at least 5 characters) — saved to the audit log with your name" style={{ resize: "vertical" }} autoFocus />
        <div style={{ fontSize: 11, color: ok ? "var(--muted-dim)" : "#b45309", margin: "4px 0 10px" }}>{ok ? "This note is saved to the audit log." : `${Math.max(0, 5 - note.trim().length)} more character(s) needed`}</div>
        {options.map((o) => (
          <label key={o.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "0 0 10px", cursor: "pointer" }}>
            <input type="checkbox" name={o.key} checked={Boolean(picked[o.key])} onChange={(e) => setPicked((prev) => ({ ...prev, [o.key]: e.target.checked }))} style={{ marginTop: 3 }} />
            <span>{o.label}</span>
          </label>
        ))}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="nav-item" style={{ width: "auto", padding: "6px 14px" }} onClick={onCancel}>Cancel</button>
          <button className="primary-btn" style={{ width: "auto", padding: "6px 16px", background: danger ? "#dc2626" : undefined }} disabled={!ok} onClick={() => onConfirm(note.trim(), picked)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
