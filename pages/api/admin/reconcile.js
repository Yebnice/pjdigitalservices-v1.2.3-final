import { requireAdminRole } from "../../../lib/adminAuth";
import { listOrders } from "../../../lib/store";
import { recordAuditEvent } from "../../../lib/auditLog";

// A small, deliberately simple CSV parser — handles quoted fields (with
// embedded commas or escaped "" quotes), which is enough for a Paystack
// export. Not a general-purpose CSV library; just enough to read one.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") { if (field !== "" || row.length > 0) pushRow(); }
    else if (c === "\r") { /* ignore, \n handles the row break */ }
    else field += c;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function findColumn(headerRow, candidates) {
  const normalized = headerRow.map((h) => String(h || "").toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = normalized.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmount(raw) {
  const cleaned = String(raw || "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function buildAiSummaryPayload(result) {
  return {
    counts: result.counts,
    note: "Explain these precomputed reconciliation totals only. Do not infer or identify individual transactions.",
  };
}

async function summarizeWithGemini(summary) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = `You are helping a small Ghana-based digital-services business reconcile their Paystack payments against their own order records. You are given ALREADY-COMPUTED, exact results — never recompute, re-check, or dispute the numbers, only explain them plainly. Write a short (4-8 sentence) plain-English summary for a non-technical business owner, in plain text with no markdown. Be direct about anything that needs their attention, and reassuring if everything matches. Here is the computed reconciliation result as JSON:\n${JSON.stringify(summary)}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, thinkingConfig: { thinkingLevel: "LOW" } },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Gemini service unavailable");
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || null;
  } catch (err) {
    console.error("Reconciliation summary (Gemini) failed:", err.message);
    return null; // the exact matching results still return either way
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminRole(req, res, ["operator"])) return;
  try {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== "string") return res.status(400).json({ error: "Paste or upload the Paystack CSV export first" });

    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ error: "That doesn't look like a CSV with a header row and data" });
    const [header, ...dataRows] = rows;

    const refIdx = findColumn(header, ["reference"]);
    const amountIdx = findColumn(header, ["amount"]);
    const statusIdx = findColumn(header, ["status"]);
    if (refIdx === -1 || amountIdx === -1) {
      return res.status(400).json({ error: "Could not find a Reference and Amount column in that file — is this a Paystack transactions export?" });
    }

    const paystackRows = dataRows
      .map((r) => ({
        reference: String(r[refIdx] || "").trim(),
        amount: parseAmount(r[amountIdx]),
        status: statusIdx !== -1 ? String(r[statusIdx] || "").trim().toLowerCase() : null,
      }))
      .filter((r) => r.reference);

    const orders = await listOrders();
    const orderByRef = new Map(orders.map((o) => [o.reference, o]));
    const paystackRefs = new Set(paystackRows.map((r) => r.reference));

    const matched = [];
    const mismatched = [];
    const paystackOnly = []; // paid on Paystack, no matching order — check for undelivered value

    for (const p of paystackRows) {
      const order = orderByRef.get(p.reference);
      if (!order) {
        paystackOnly.push(p);
        continue;
      }
      // Compare against checkoutAmount (what Paystack actually charged,
      // product price + fee markup), not the bare product `amount` — the
      // Paystack export's "Amount" column is always the amount charged to
      // the card/wallet. Fall back to `amount` for orders that predate the
      // checkoutAmount field.
      const expectedAmount = Number(order.checkoutAmount ?? order.amount);
      const amountOk = p.amount == null || Math.abs(p.amount - expectedAmount) < 0.01;
      const statusOk = !p.status || p.status === "reversed"
        ? order.status !== "success"
        : (p.status === "success") === (order.status === "success");
      if (amountOk && statusOk) {
        matched.push({ reference: p.reference });
      } else {
        mismatched.push({
          reference: p.reference,
          paystackAmount: p.amount,
          appAmount: expectedAmount,
          paystackStatus: p.status,
          appStatus: order.status,
        });
      }
    }

    // App orders marked "success" with no corresponding row at all in this
    // export — only meaningful if the uploaded file is a complete export
    // for the period, which is noted in the response for the admin to see.
    const appOnly = orders
      .filter((o) => o.status === "success" && !paystackRefs.has(o.reference))
      .map((o) => ({ reference: o.reference, amount: Number(o.checkoutAmount ?? o.amount), orderType: o.orderType }));

    const result = {
      counts: {
        paystackRows: paystackRows.length,
        appOrders: orders.length,
        matched: matched.length,
        mismatched: mismatched.length,
        paystackOnly: paystackOnly.length,
        appOnly: appOnly.length,
      },
      mismatched,
      paystackOnly,
      appOnly,
      note: "\"App-only\" entries are only meaningful if the uploaded file covers the full date range and includes every successful transaction for that period.",
    };

    result.summary = generateAiSummary ? await summarizeWithGemini(buildAiSummaryPayload(result)) : null;

    await recordAuditEvent({
      actor: actor.username,
      action: "reconciliation_run",
      note: `${result.counts.matched} matched, ${result.counts.mismatched} mismatched, ${result.counts.paystackOnly} Paystack-only, ${result.counts.appOnly} app-only`,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Reconciliation error", err);
    return res.status(500).json({ error: "Could not run reconciliation" });
  }
}
