// CSV export for records and reconciliation. Cells that start with = + - @ (or a tab or
// carriage return) are prefixed with an apostrophe so a spreadsheet shows them as text and
// never runs them as a formula: customer-supplied names and notes end up in these files.
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    // A plain negative number is a number, not a formula.
    if (!/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ key, label }] or [{ label, value: (row) => ... }]
export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = (rows || []).map((r) => columns.map((c) => csvCell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","));
  return [head, ...body].join("\r\n");
}

// Browser only: offers the CSV as a file download.
export function downloadCsv(filename, text) {
  const blob = new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
