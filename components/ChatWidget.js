import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Search, Sparkles, UserRound, Headphones, ShieldCheck } from "lucide-react";

const QUICK = ["Instant Airtime", "Quick Data Top-up", "Track my order", "ECG bill"];
const SERVICES = ["data", "airtime", "ECG", "water", "TV", "AFA", "result checker", "other"];

const EMPTY_COMPLAINT = {
  name: "",
  email: "",
  phone: "",
  serviceType: "data",
  transactionId: "",
  transactionAmount: "",
  requestedData: "",
  beneficiary: "",
  transactionAt: "",
  orderReference: "",
  transactionDetails: "",
  message: "",
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hello! 😊 I'm Annette from PjDigitalServices. I'm here to help. What would you like to do today — make a purchase, check your order, or resolve an issue?" },
  ]);
  const [loading, setLoading] = useState(false);
  const [aiMode, setAiMode] = useState("unknown");

  const [trackMode, setTrackMode] = useState(false);
  const [orderReference, setOrderReference] = useState("");
  const [orderEmail, setOrderEmail] = useState("");

  const [complaintMode, setComplaintMode] = useState(false);
  const [complaint, setComplaint] = useState(EMPTY_COMPLAINT);
  const [complaintBusy, setComplaintBusy] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Without this, every new reply lands below the visible scroll area and
  // the person has to manually scroll down to read it — easy to miss on a
  // small 320px-wide panel.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (open && !trackMode && !complaintMode) inputRef.current?.focus();
  }, [open, trackMode, complaintMode]);

  const isDataOrAirtime = complaint.serviceType === "data" || complaint.serviceType === "airtime";
  const setC = (key, value) => setComplaint((c) => ({ ...c, [key]: value }));

  async function send(text = input, extra = {}) {
    if (!text.trim() || loading) return;
    const next = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, ...extra }),
      });
      let data = {};
      try {
        data = await r.json();
      } catch {
        data = {};
      }
      // Surface the real reason (e.g. rate limiting) instead of a generic
      // "couldn't answer" message whenever the server actually told us why.
      const content = data.reply || data.error || "Sorry, I couldn't answer that just now.";
      setAiMode(data.source === "gemini" ? "gemini" : data.source === "support-rule" ? "support" : "faq");
      setMessages((m) => [...m, { role: "assistant", content }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't reach support right now. Please use the Feedback page for urgent issues." }]);
    } finally {
      setLoading(false);
    }
  }

  async function checkOrder() {
    if (!orderReference || !orderEmail.includes("@")) return;
    setTrackMode(false);
    await send(`Please check the status of order ${orderReference}.`, { orderReference, orderEmail });
  }

  function complaintMissingFields() {
    const missing = [];
    if (!complaint.name.trim()) missing.push("name");
    if (!complaint.email.trim() && !complaint.phone.trim()) missing.push("email or phone");
    if (!complaint.transactionId.trim()) missing.push("transaction ID");
    if (!complaint.transactionAmount) missing.push("amount");
    if (!complaint.transactionAt) missing.push("transaction date & time");
    if (!complaint.transactionDetails.trim()) missing.push("transaction details");
    if (!complaint.message.trim()) missing.push("description");
    if (isDataOrAirtime && !complaint.requestedData.trim()) missing.push("data/airtime requested");
    if (isDataOrAirtime && !complaint.beneficiary.trim()) missing.push("recipient/beneficiary");
    return missing;
  }

  async function submitComplaint() {
    if (complaintMissingFields().length) return;
    setComplaintBusy(true);
    try {
      const r = await fetch("/api/feedback/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...complaint, category: "delivery issue" }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages((m) => [...m, { role: "assistant", content: d.error || "Could not submit the complaint." }]);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: `Your issue has been submitted and escalated to our support team. Support case: ${d.feedback?.caseReference}. Please keep this reference for follow-up.` }]);
      setComplaintMode(false);
      setComplaint(EMPTY_COMPLAINT);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't submit the complaint right now. Please use the Feedback & complaints page." }]);
    } finally {
      setComplaintBusy(false);
    }
  }

  function handleQuickAction(q) {
    if (q === "Track my order") setTrackMode(true);
    else if (q === "Report a problem" || q === "Talk to a person") setComplaintMode(true);
    else send(q);
  }

  return (
    <>
      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-agent">
              <div className="chat-avatar" aria-label="Annette avatar" role="img">👩🏾‍💼</div>
              <div style={{ minWidth: 0 }}>
                <div className="chat-agent-name">Annette <span className="chat-agent-role">· Support</span></div>
                <div className="chat-status-row">
                  <span className="chat-status-dot" />
                  <span>{aiMode === "gemini" ? "AI support is active" : aiMode === "support" ? "Support guidance" : aiMode === "faq" ? "Quick-help mode" : "Ready to help"}</span>
                </div>
              </div>
            </div>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close support chat">
              <X size={16} />
            </button>
          </div>
          <div className="chat-welcome">
            <div className="chat-welcome-icon"><Headphones size={15} /></div>
            <div>
              <div className="chat-welcome-title">How can I help today?</div>
              <div className="chat-welcome-text">I can help with purchases, order updates and support. For anything sensitive or complex, I'll guide you to a person.</div>
            </div>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-row ${m.role === "assistant" ? "bot-row" : "user-row"}`}>
                {m.role === "assistant" && <div className="chat-mini-avatar" aria-hidden="true">👩🏾‍💼</div>}
                <div className={`chat-msg ${m.role === "assistant" ? "bot" : "user"}`}>
                  {m.role === "assistant"
                    ? String(m.content || "").split(/(https?:\/\/\S+)/g).map((part, j) =>
                        /^https?:\/\/\S+$/.test(part)
                          ? <a key={j} href={part} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Open WhatsApp</a>
                          : <span key={j}>{part}</span>
                      )
                    : m.content}
                </div>
                {m.role === "user" && <div className="chat-mini-avatar user-avatar"><UserRound size={11} /></div>}
              </div>
            ))}
            {loading && (
              <div className="chat-row bot-row">
                <div className="chat-mini-avatar"><Sparkles size={11} /></div>
                <div className="chat-msg bot chat-typing"><span /><span /><span /></div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-quick-label">Popular help</div>
          <div className="chat-quick">
            {QUICK.map((q) => (
              <button key={q} onClick={() => handleQuickAction(q)}>{q}</button>
            ))}
            <button onClick={() => setComplaintMode(true)} className="chat-human-chip"><Headphones size={12} /> Get human help</button>
          </div>

          {trackMode && (
            <div className="chat-tool-card">
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                For privacy, provide both details. They are used only for this lookup.
              </div>
              <input className="input" value={orderReference} onChange={(e) => setOrderReference(e.target.value)} placeholder="Order reference" style={{ marginBottom: 8 }} />
              <input className="input" type="email" value={orderEmail} onChange={(e) => setOrderEmail(e.target.value)} placeholder="Checkout email" style={{ marginBottom: 8 }} />
              <button className="primary-btn" onClick={checkOrder} disabled={!orderReference || !orderEmail.includes("@")}>
                <Search size={14} style={{ marginRight: 6 }} /> Check securely
              </button>
            </div>
          )}

          {complaintMode && (
            <div className="chat-tool-card chat-complaint-card">
              <div className="chat-tool-heading">
                <ShieldCheck size={14} />
                <div>
                  <div className="chat-tool-title">Let's get this sorted</div>
                  <div className="chat-tool-subtitle">I'll collect the details support needs — no passwords, PINs or one-time codes.</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                Data and airtime complaints require all transaction fields. Other products still require transaction details.
              </div>
              <input className="input" value={complaint.name} onChange={(e) => setC("name", e.target.value)} placeholder="Your name" style={{ marginBottom: 8 }} />
              <input className="input" value={complaint.email} onChange={(e) => setC("email", e.target.value)} placeholder="Email" style={{ marginBottom: 8 }} />
              <input className="input" value={complaint.phone} onChange={(e) => setC("phone", e.target.value)} placeholder="Phone" style={{ marginBottom: 8 }} />
              <select className="input" value={complaint.serviceType} onChange={(e) => setC("serviceType", e.target.value)} style={{ marginBottom: 8 }}>
                {SERVICES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <input className="input" value={complaint.transactionId} onChange={(e) => setC("transactionId", e.target.value)} placeholder="Transaction ID" style={{ marginBottom: 8 }} />
              <input className="input" type="number" min="0" step="0.01" value={complaint.transactionAmount} onChange={(e) => setC("transactionAmount", e.target.value)} placeholder="Amount (GHS)" style={{ marginBottom: 8 }} />
              {isDataOrAirtime && (
                <input
                  className="input"
                  value={complaint.requestedData}
                  onChange={(e) => setC("requestedData", e.target.value)}
                  placeholder={complaint.serviceType === "data" ? "Data requested, e.g. 5GB MTN" : "Data/Airtime requested, e.g. GHS 20 MTN airtime"}
                  style={{ marginBottom: 8 }}
                />
              )}
              <input className="input" value={complaint.beneficiary} onChange={(e) => setC("beneficiary", e.target.value)} placeholder="Recipient / beneficiary" style={{ marginBottom: 8 }} />
              <input className="input" type="datetime-local" value={complaint.transactionAt} onChange={(e) => setC("transactionAt", e.target.value)} style={{ marginBottom: 8 }} />
              <input className="input" value={complaint.orderReference} onChange={(e) => setC("orderReference", e.target.value)} placeholder="Order reference (if available)" style={{ marginBottom: 8 }} />
              <textarea className="input" rows={2} value={complaint.transactionDetails} onChange={(e) => setC("transactionDetails", e.target.value)} placeholder="Transaction details" style={{ marginBottom: 8 }} />
              <textarea className="input" rows={3} value={complaint.message} onChange={(e) => setC("message", e.target.value)} placeholder="Describe the complaint" style={{ marginBottom: 8 }} />
              <button className="primary-btn" onClick={submitComplaint} disabled={complaintBusy}>
                {complaintBusy ? "Submitting…" : "Submit complaint"}
              </button>
            </div>
          )}

          <div className="chat-input-wrap">
            <input
              ref={inputRef}
              className="input"
              style={{ flex: 1 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask Annette anything…"
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{ background: "var(--blue)", border: "none", borderRadius: 8, width: 38, display: "flex", alignItems: "center", justifyContent: "center", opacity: loading || !input.trim() ? 0.6 : 1 }}
            >
              <Send size={15} color="#fff" />
            </button>
          </div>
        </div>
      )}
      <button className="chat-bubble" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </>
  );
}
