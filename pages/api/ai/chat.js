import { faqReply } from "../../../lib/assistant";
import { rateLimit } from "../../../lib/rateLimit";
import { findCustomerOrder, toPublicOrder } from "../../../lib/store";

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-8).map((m) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content || "").slice(0, 2000),
  })).filter((m) => m.content);
}

async function askGemini(messages, order) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const orderContext = order ? `\nVerified order context (safe customer-facing fields only): ${JSON.stringify(order)}` : "";
  const system = `You are Annette, PjDigitalServices customer support for a Ghana-focused digital services storefront. If asked your name, say you're Annette. Answer clearly and briefly, in plain conversational text only — no markdown (no asterisks, no headers, no numbered-list syntax); the chat window displays raw text, so any markdown shows up as literal symbols. Never invent prices, payment success, order status, refunds, Techlink results, or service availability. Never request or repeat card numbers, PINs, mobile-money PINs, passwords, Ghana Card numbers, dates of birth, or other sensitive identity data in chat. If live order context is provided, explain only those safe fields. For payments and purchases, direct the customer to the website checkout; never claim you can charge a customer from chat. If the issue needs a human, direct the customer to the Feedback & complaints page. For data or airtime complaints, tell the customer the form requires Transaction ID, Amount, Data/Airtime Requested, Recipient/Beneficiary, Transaction Date & Time, and Transaction Details. For other products, tell them to complete the normal support form with relevant transaction details. Use the store's public service knowledge: MTN/Telecel/AirtelTigo data and airtime, ECG, Ghana Water, DSTV/GOtv/StarTimes, AFA, and result checkers.${orderContext}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
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

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "Gemini service unavailable";
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((part) => typeof part?.text === "string")
    ?.map((part) => part.text)
    ?.join("\n")
    ?.trim();

  return text || null;
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

    const ai = await askGemini(messages, order);
    return res.status(200).json({ reply: ai || faqReply(messages[messages.length - 1].content), liveOrderChecked: Boolean(reference && email.includes("@")) });
  } catch (err) {
    console.error("AI chat error", err);
    return res.status(200).json({ reply: faqReply(req.body?.messages?.at?.(-1)?.content || "") });
  }
}
