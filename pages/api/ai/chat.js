import { faqReply, supportReply } from "../../../lib/assistant";
import { rateLimit } from "../../../lib/rateLimit";
import { findCustomerOrder, toPublicOrder } from "../../../lib/store";

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/(?:\d[ -]?){13,19}/g, "[REDACTED_CARD_NUMBER]")
    .replace(/\b(ghana\s*card(?:\s*(?:no|number))?|pin|otp|one[- ]time(?:\s+pass(?:word|code))?|password|passcode|cvv|cvc)\s*[:#-]?\s*[A-Za-z0-9-]{2,32}/gi, "$1 [REDACTED]")
    .slice(0, 2000);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  // Assistant turns come from the browser and therefore are untrusted.
  // Do not feed client-injected "assistant" instructions back to Gemini.
  return messages.slice(-8)
    .filter((m) => m?.role !== "assistant")
    .map((m) => ({
      role: "user",
      content: redactSensitiveText(m?.content),
    }))
    .filter((m) => m.content);
}

async function callGemini(model, messages, system) {
  const apiKey = process.env.GEMINI_API_KEY;
  const timeoutMs = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || 15000));
  const maxAttempts = Math.max(1, Math.min(4, Number(process.env.GEMINI_MAX_RETRIES || 3)));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: 450,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = data?.candidates?.[0]?.content?.parts
          ?.filter((part) => typeof part?.text === "string")
          ?.map((part) => part.text)
          ?.join("\n")
          ?.trim();
        return text || null;
      }

      const message = data?.error?.message || "Gemini service unavailable";
      const status = Number(response.status || data?.error?.code || 0);
      const transient = [408, 429, 500, 502, 503, 504].includes(status);

      if (!transient || attempt === maxAttempts) {
        const err = new Error(message);
        err.status = status;
        throw err;
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      const exponentialMs = Math.min(8000, 500 * (2 ** (attempt - 1)));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(10000, retryAfter * 1000)
        : exponentialMs + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } catch (err) {
      const transient = ["AbortError", "TimeoutError", "TypeError"].includes(err?.name) || [408, 429, 500, 502, 503, 504].includes(Number(err?.status));
      if (!transient || attempt === maxAttempts) throw err;
      const waitMs = Math.min(8000, 500 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return null;
}

async function askGemini(messages, order) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const orderContext = order ? `\nVerified order context (safe customer-facing fields only): ${JSON.stringify(order)}` : "";
  const system = `You are Annette, PjDigitalServices customer support for a Ghana-focused digital services storefront. You are an AI-assisted support agent. If asked your name, say you're Annette.

GROUNDING — treat the website's Delivery & selling rules as authoritative for customer-facing answers. Airtime top-ups for MTN, Telecel and AirtelTigo are instant after Paystack payment confirmation. Quick Data Top-up on the /data page is the instant data service; after payment confirmation, the selected bundle is sent automatically. MTN Master is a separate non-instant data tier and can take about 30 minutes to a few hours, sometimes longer when the provider queue is busy. MTN Master also tells customers who need urgent data to dial *138# directly. MTN Express is usually delivered much sooner than Master. AT iShare and AT BigTime are for AirtelTigo numbers only; the accepted prefixes shown by the site are 026, 056, 027, 057, 023 and 053. The common selling rules are: ensure the line does not owe any amount before buying data; Turbonet and Broadband SIMs are not eligible; duplicate purchases are non-refundable; and customers must double-check the recipient number because wrong-number orders are non-refundable. Use these rules to explain likely delivery problems, prevent duplicate purchases, and guide customers to Feedback & complaints when a rule-related problem has already happened. Do not describe a rule-related problem as formally escalated unless the verified order status is manual_review or a support complaint has just been successfully submitted. Do not invent an exact delivery guarantee beyond the published service facts above.

Response policy: use the verified service facts above, the safe order context when supplied, and the customer's actual question. If a fact is unknown, say so and point to the relevant page or support channel rather than guessing. Prefer one or two short paragraphs. Give the customer the next useful action, not just information. Never repeat sensitive data back to the customer.

Personality: warm, upbeat, and genuinely helpful — like a friendly, competent person, not a corporate script. Use natural contractions ("you're", "that'll"). Open with a bit of warmth rather than jumping straight into policy. When something's gone wrong for the customer, lead with a short, sincere acknowledgment ("Sorry about that, let's sort it out") before the practical steps — don't over-apologize or gush. Celebrate good news briefly when it fits (an order going through, a bundle delivering fast). One emoji at most per reply, only when it genuinely fits the moment (e.g. a friendly 🙂 or ✅ after good news) — never stack them, never use them in a complaint/refund conversation. Keep it concise either way: brief and warm beats long and warm.

Answer clearly and briefly, in plain conversational text only — no markdown (no asterisks, no headers, no numbered-list syntax); the chat window displays raw text, so any markdown shows up as literal symbols. Never invent prices, payment success, order status, refunds, Techlink results, or service availability. Never request or repeat card numbers, PINs, mobile-money PINs, passwords, Ghana Card numbers, dates of birth, or other sensitive identity data in chat. If a customer asks whether a message, call, or account claiming to be PjDigitalServices asking for their password, PIN, or a one-time code is legitimate, tell them clearly it is not — PjDigitalServices never asks for those by phone, email, or WhatsApp, and they should not share anything and should report it via the Feedback page. If live order context is provided, explain only those safe fields. For payments and purchases, direct the customer to the website checkout; never claim you can charge a customer from chat. If the issue needs a human, direct the customer to the Feedback & complaints page. For data or airtime complaints, tell the customer the form requires Transaction ID, Amount, Data/Airtime Requested, Recipient/Beneficiary, Transaction Date & Time, and Transaction Details. Never say an issue has been formally escalated unless the verified order context has fulfillmentStatus "manual_review" or the customer has just successfully submitted a support complaint. When a verified order is in "manual_review", tell the customer the issue has been escalated to the support team for manual review and advise them not to place a duplicate order or make another payment. For other products, tell them to complete the normal support form with relevant transaction details. Use the store's public service knowledge: MTN/Telecel/AirtelTigo data and airtime, ECG, Ghana Water, DSTV/GOtv/StarTimes, AFA, and result checkers. Before-you-buy rules for data and airtime you can share if asked: don't buy if the line has an outstanding balance (the bundle won't deliver and it isn't refunded); Turbonet and Broadband SIMs aren't eligible for data bundles; don't place duplicate orders (they aren't refunded); double-check the phone number before paying (wrong-number orders aren't refunded either).${orderContext}`;

  // Keep the model configurable. Gemini 3.8 Flash is the current stable
  // default for new projects; set GEMINI_MODEL explicitly to another
  // supported model when cost/latency needs differ.
  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModel = "gemini-3.5-flash-lite";
  try {
    const text = await callGemini(primaryModel, messages, system);
    return { text, model: primaryModel };
  } catch (err) {
    console.error(`Gemini call failed on ${primaryModel}:`, err.message);
    if (primaryModel === fallbackModel) throw err;
    try {
      const text = await callGemini(fallbackModel, messages, system);
      return { text, model: fallbackModel };
    } catch (fallbackErr) {
      console.error(`Gemini call failed on fallback ${fallbackModel}:`, fallbackErr.message);
      throw fallbackErr;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rl = rateLimit(req, { limit: 15, windowMs: 60_000, keySuffix: "ai" });
  if (!rl.allowed) return res.status(429).setHeader("Retry-After", rl.retryAfter).json({ error: "Too many requests. Please wait a moment and try again." });
  try {
    const messages = sanitizeMessages(req.body?.messages);
    if (!messages.length) return res.status(400).json({ error: "Message is required" });

    let order = null;
    const reference = String(req.body?.orderReference || "").trim();
    const email = String(req.body?.orderEmail || "").trim().toLowerCase();
    if (reference && email.includes("@")) order = toPublicOrder(await findCustomerOrder(reference, email));

    const userText = messages[messages.length - 1].content;
    const deterministicSupportReply = supportReply(userText, order);

    // Complaint, escalation and verified order-status responses are deliberately
    // deterministic so customers receive consistent wording and we never claim
    // an escalation that the order state does not support.
    if (deterministicSupportReply) {
      return res.status(200).json({
        reply: deterministicSupportReply,
        source: "support-rule",
        model: null,
        liveOrderChecked: Boolean(reference && email.includes("@")),
      });
    }

    const ai = await askGemini(messages, order);
    const fallback = faqReply(userText, messages);
    return res.status(200).json({
      reply: ai?.text || fallback,
      source: ai?.text ? "gemini" : "faq",
      model: ai?.model || null,
      liveOrderChecked: Boolean(reference && email.includes("@")),
    });
  } catch (err) {
    console.error("AI chat error", err);
    return res.status(200).json({ reply: faqReply(req.body?.messages?.at?.(-1)?.content || "", req.body?.messages || []), source: "faq", model: null });
  }
}
