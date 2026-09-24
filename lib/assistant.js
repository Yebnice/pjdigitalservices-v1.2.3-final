const FRIENDLY_SIGNOFF = "I'm here to help — just tell me what you need.";


export const SUPPORT_TEMPLATES = {
  dissatisfied: "I'm sorry your experience hasn't gone as expected. I understand how frustrating that can be, and I appreciate you letting us know. I'd like to help get this sorted. Please tell me what went wrong. If this is about an order, share your Transaction ID/order reference and the phone number or email used for the order. Please don't send your password, PIN, OTP, or other sensitive information.",
  angry: "I understand you're upset, and I'm sorry for the frustration this situation has caused. You shouldn't have to keep chasing us for an update. Let me help get the issue properly documented and directed to the right support team. Please send your Transaction ID/order reference, amount paid, service or product purchased, and the phone number or email used for the order. Please don't send your password, PIN, OTP, or other sensitive information.",
  delayed: "I'm sorry your order is taking longer than expected. I understand how frustrating that can be, especially after you've already made payment. Let's check the situation and make sure the order is properly followed up. Please provide your Transaction ID/order reference and the phone number or email used for the order. Please don't make another payment or place a duplicate order while we're checking the original one.",
  refund: "I understand that you're requesting a refund, and I'm sorry this order hasn't worked out as expected. I'll help you provide the details needed for the support team to review the transaction and advise you on the applicable resolution. Please provide your Transaction ID/order reference, amount paid, product or service ordered, and the reason for the refund request.",
  noHelp: "I'm sorry you've had to follow up repeatedly. I understand why you're frustrated. Let's start from here and make sure the correct details are captured. Please send your Transaction ID/order reference and a brief description of what has happened. I'll guide you through the next step.",
  human: "I understand. This needs personal attention from our support team. I'll help you prepare the details so you don't have to explain everything again. Please provide your Transaction ID/order reference and a brief description of the issue. The support team can then review the case and follow up with you.",
  manualReview: "I've checked your order, and I can see that the issue has been escalated to our support team for manual review. Please don't place another order or make another payment while they confirm the provider outcome. Keep your order reference handy for follow-up.",
  queued: "I've checked your order. It has been accepted by the provider and is still being processed, so it has not yet been confirmed as completed. Please don't place a duplicate order while it is being processed. If it remains delayed, support can follow up with the provider.",
  processing: "I've checked your order. Your payment has been received and the order is currently being processed. Please give it a little time, and please don't place a duplicate order while the original order is being handled.",
  fulfilled: "I've checked your order and it has been completed successfully. ✅",
  failed: "I've checked your order. It could not be completed successfully. Please don't place another order yet. Our support team can review the transaction and advise on the next step."
};

const SUPPORT_INTENT_PATTERNS = {
  angry: ["angry", "furious", "upset", "fed up", "ridiculous", "terrible", "worst", "useless", "waste of time", "not happy", "very disappointed"],
  dissatisfied: ["dissatisfied", "disappointed", "unhappy", "poor service", "bad service", "not satisfied", "complaining", "complaint"],
  delayed: ["delay", "delayed", "taking too long", "still waiting", "not received", "didn't receive", "did not receive", "not arrived", "hasn't arrived", "hasnt arrived", "where is my order", "my order is late"],
  refund: ["refund", "money back", "give me my money", "return my money", "reverse the payment"],
  human: ["human", "agent", "person", "manager", "customer care", "support team", "talk to someone", "speak to someone", "escalate", "escalated"]
};

function matchesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function orderStatusReply(order) {
  if (!order) return null;
  const status = String(order.fulfillmentStatus || "").toLowerCase();
  const reference = order.reference ? " Order " + order.reference + "." : "";

  if (status === "manual_review") return SUPPORT_TEMPLATES.manualReview + reference;
  if (status === "queued_with_provider") return SUPPORT_TEMPLATES.queued + reference;
  if (status === "processing") return SUPPORT_TEMPLATES.processing + reference;
  if (status === "fulfilled") return SUPPORT_TEMPLATES.fulfilled + reference;
  if (status === "failed") return SUPPORT_TEMPLATES.failed + reference;
  if (status === "ready" || status === "payment_verified") return "I've checked your order." + reference + " Your payment has been confirmed and the order is waiting to be fulfilled. Please don't place a duplicate order while we process it.";
  if (status === "pending") return "I've checked your order." + reference + " It is still at the initial order stage. If you have already completed payment, please keep the order reference and payment details handy while we verify the order.";
  return "I've checked your order." + reference + " The current order status is " + (status || "being checked") + ". Please keep the order reference handy and don't place a duplicate order.";
}

const SELLING_RULE_PATTERNS = {
  outstandingBalance: ["owe", "outstanding balance", "balance on my line", "line has a balance", "debt on my line"],
  ineligibleSim: ["turbonet", "broadband sim", "broadband line", "broadband"],
  duplicate: ["duplicate order", "duplicated order", "ordered twice", "two orders", "placed twice", "double order"],
  wrongNumber: ["wrong number", "sent to wrong number", "wrong phone number", "incorrect number", "mistyped number"],
  airtelTigoPrefix: ["026", "056", "027", "057", "023", "053", "airteltigo prefix", "airtel tigo number"],
  urgentMaster: ["urgent data", "need data urgently", "need it now", "mtn master urgent", "master urgent"],
  masterDelay: ["mtn master", "master data", "master taking", "master delayed"],
};

export function sellingRuleReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  if (matchesAny(t, SELLING_RULE_PATTERNS.duplicate)) {
    return "Our Delivery & selling rules say duplicate purchases are non-refundable. Please don't place another order. If you've already placed a duplicate order and need help, send the order reference and transaction details through Feedback & complaints so support can review both transactions.";
  }

  if (matchesAny(t, SELLING_RULE_PATTERNS.wrongNumber)) {
    return "Our Delivery & selling rules require you to double-check the recipient number before confirming payment. Orders sent to the wrong number are non-refundable. If this has already happened, please send the order reference and transaction details through Feedback & complaints so support can review the case.";
  }

  if (matchesAny(t, SELLING_RULE_PATTERNS.outstandingBalance)) {
    return "One of our Delivery & selling rules is to make sure the line does not owe any amount before buying data. An outstanding balance can prevent the bundle from delivering, and that purchase is not refundable. If you've already paid and the bundle did not arrive, don't place another order — send the order reference through Feedback & complaints so support can investigate.";
  }

  if (matchesAny(t, SELLING_RULE_PATTERNS.ineligibleSim)) {
    return "Our Delivery & selling rules state that Turbonet and Broadband SIMs are not eligible for these data bundles. If you've already paid for an ineligible line, please don't place another order. Send the order reference and transaction details through Feedback & complaints so support can review what happened.";
  }

  if (matchesAny(t, SELLING_RULE_PATTERNS.airtelTigoPrefix) && (t.includes("valid") || t.includes("prefix") || t.includes("number") || t.includes("at "))) {
    return "For AT iShare and AT BigTime, our Delivery & selling rules require an AirtelTigo number. The accepted prefixes shown on the site are 026, 056, 027, 057, 023 and 053. If you've already paid and the number was not eligible, please don't place another order; send the order reference through Feedback & complaints so support can review it.";
  }

  if (matchesAny(t, SELLING_RULE_PATTERNS.urgentMaster) || matchesAny(t, SELLING_RULE_PATTERNS.masterDelay)) {
    return "MTN Master is a non-instant tier under our Delivery & selling rules. It can take about 30 minutes to a few hours and may take longer when the provider queue is busy. If you need data urgently, the rule shown on the MTN Master page is to dial *138# directly. If you've already paid and the order is outside the expected window, please share the order reference so we can check its status.";
  }

  return null;
}

export function supportReply(text, order = null) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  const asksForStatus = matchesAny(t, ["track", "status", "where is my order", "check my order", "order update", "what happened to my order"]);

  // A verified order status always takes priority over generic complaint wording.
  // manual_review is the only customer-facing state that should be described as
  // formally escalated.
  if (order && asksForStatus) return orderStatusReply(order);

  if (order?.fulfillmentStatus === "manual_review" && (matchesAny(t, SUPPORT_INTENT_PATTERNS.delayed) || matchesAny(t, SUPPORT_INTENT_PATTERNS.angry) || matchesAny(t, SUPPORT_INTENT_PATTERNS.dissatisfied) || matchesAny(t, SUPPORT_INTENT_PATTERNS.human))) {
    return orderStatusReply(order);
  }

  const ruleReply = sellingRuleReply(t);
  if (ruleReply) return ruleReply;

  if (matchesAny(t, SUPPORT_INTENT_PATTERNS.angry)) return SUPPORT_TEMPLATES.angry;
  if (matchesAny(t, SUPPORT_INTENT_PATTERNS.dissatisfied)) return SUPPORT_TEMPLATES.dissatisfied;
  if (matchesAny(t, SUPPORT_INTENT_PATTERNS.delayed)) return SUPPORT_TEMPLATES.delayed;
  if (matchesAny(t, SUPPORT_INTENT_PATTERNS.refund)) return SUPPORT_TEMPLATES.refund;
  if (matchesAny(t, SUPPORT_INTENT_PATTERNS.human)) return SUPPORT_TEMPLATES.human;

  return null;
}

export const FAQ_RULES = [
  { keys: ["airtime instant", "instant airtime", "airtime delivery", "how fast airtime", "how fast is airtime", "how quickly is airtime", "airtime how long", "airtime seconds", "is airtime instant"], reply: "Yes — MTN, Telecel and AirtelTigo airtime top-ups are instant after your Paystack payment is confirmed. Enter the recipient number and amount on Buy Airtime, complete payment, and the top-up is sent automatically. If an instant top-up does not arrive, please check My Orders and contact support before placing another order." },
  { keys: ["quick data", "quick data top-up", "quick data top up", "instant data", "data top-up", "data top up"], reply: "Yes — Quick Data Top-up is our instant data option. After your Paystack payment is confirmed, the selected MTN, Telecel or AirtelTigo bundle is sent automatically. If it does not arrive, please check My Orders and contact support before placing a duplicate order." },
  { keys: ["mtn master", "mtn express", "how long", "delivery time", "delivery speed"], reply: "For delivery timing: Airtime and Quick Data Top-up are instant after payment confirmation. MTN Master is different — it is a non-instant tier and can take 30 minutes to a few hours. MTN Express is usually much faster than Master. Your order status is available from My Orders or Track Order." },
  { keys: ["track", "order", "status", "where is", "dashboard"], reply: "I can help you check an order. Use your order reference together with the checkout email on the Track Order page. For your security, we don't search customer orders by phone or email alone." },
  { keys: ["airtime"], reply: "We provide MTN, Telecel and AirtelTigo airtime with instant delivery after Paystack payment confirmation. Open Buy Airtime, enter the recipient number and amount, review the details carefully, then pay." },
  { keys: ["data", "bundle"], reply: "Quick Data Top-up is our instant data option for MTN, Telecel and AirtelTigo. Bundle pricing is loaded from the available provider catalogue and confirmed server-side at checkout. MTN Master is a separate non-instant tier." },
  { keys: ["before you buy", "before buying", "outstanding balance", "owe", "turbonet", "broadband sim", "duplicate order", "wrong number"], reply: "Before buying, please check the recipient number carefully. For data, make sure the line has no outstanding balance, because the bundle may not deliver and the order is not refundable. Turbonet and Broadband SIMs aren't eligible for data bundles, duplicate orders aren't refunded, and wrong-number purchases aren't refunded." },
  { keys: ["ecg", "electricity", "light"], reply: "You can pay an ECG electricity bill from the Bills page. Enter the meter details, confirm the account information shown, and then pay securely through Paystack." },
  { keys: ["water"], reply: "Ghana Water bill payments are available on the Bills page. We validate the account first and show the amount due before you pay." },
  { keys: ["afa", "sim", "register sim", "farmer"], reply: "AFA registration is available on the AFA page. It requires the registration information requested there, including Ghana Card details. Please enter sensitive information only in the secure form — never send it in chat." },
  { keys: ["tv", "dstv", "gotv", "startimes"], reply: "TV subscriptions for DStv, GOtv and StarTimes are handled from the TV page. We validate the smartcard first so you can confirm the subscription details before paying." },
  { keys: ["checker", "bece", "wassce", "result"], reply: "The Result Checker page supports voucher purchases and a separate result-check request. The result-check request is not guaranteed to be instant." },
  { keys: ["complain", "complaint", "problem", "issue", "refund", "didn't receive", "not received"], reply: "I'm sorry you're having trouble. Let's get it sorted without creating a duplicate transaction. For a data or airtime delivery issue, use the Feedback & complaints page and include your transaction ID, amount, data/airtime requested, recipient or beneficiary, transaction date and time, transaction details, and a brief description of the issue. Keep your order reference handy." },
  { keys: ["pin", "password", "otp", "one-time code", "one time code", "verification code", "do you take my pin", "do you need my pin"], reply: "No. PjDigitalServices will never ask you to send your card PIN, mobile-money PIN, password, or one-time verification code in chat. Complete payment only through the secure Paystack checkout, and report any person asking for these details through Feedback & complaints." },
  { keys: ["pay", "payment", "paystack", "card", "momo", "mobile money"], reply: "Payments are handled through Paystack's secure checkout. We do not ask for your card PIN, mobile-money PIN, password, or one-time verification code in chat. Successful payments are checked on the server before fulfillment." },
  { keys: ["fee", "charge", "processing fee"], reply: "The checkout shows the full amount before you pay, including the Paystack processing fee. Please rely on the amount shown at checkout rather than a price quoted in chat." },
  { keys: ["faq", "question", "help"], reply: `Absolutely — I can help with instant Airtime, instant Quick Data Top-up, other data bundles, ECG, water, TV, AFA, result checkers, payments and order tracking. ${FRIENDLY_SIGNOFF}` },
  { keys: ["contact", "human", "agent", "support", "call"], reply: "For something that needs a person, please use the Feedback & complaints page. Include your order reference and the transaction details so the support team can investigate it quickly." },
];

export const FALLBACK = "Absolutely — I can help with Airtime, Quick Data Top-up, data bundles, ECG, water, TV, AFA, result checkers, payments or order tracking. Tell me what you're trying to do, and I'll guide you from there. 🙂";

// Matched separately, BEFORE the keyword rules below, and only when the
// ENTIRE message is just a greeting.
const GREETING_ONLY = /^(hi+|hello+|hey+|hiya|yo|sup|good morning|good afternoon|good evening)[\s!.,]*$/i;
const GREETING_REPLY_FIRST = "Hey! 😊 I'm Annette. I'm right here with you. What are you looking to do today — buy airtime or Quick Data, check an order, or sort out a problem?";
const GREETING_REPLY_AGAIN = "Hi again! 😊 I'm still here. Tell me what you're trying to do and we'll take it one step at a time.";

function hasMeaningfulConversation(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.filter((m) => String(m?.content || "").trim()).length > 2;
}

export function faqReply(text, messages = []) {
  const raw = String(text || "").trim();
  if (GREETING_ONLY.test(raw)) {
    return hasMeaningfulConversation(messages) ? GREETING_REPLY_AGAIN : GREETING_REPLY_FIRST;
  }

  const t = raw.toLowerCase();
  if (matchesAny(t, ["thanks", "thank you", "thx", "appreciate it"])) {
    return "You're very welcome. 😊 I'm here with you — what would you like to do next?";
  }
  if (matchesAny(t, ["okay", "ok", "alright", "got it", "understood"])) {
    return "Perfect. 🙂 Whenever you're ready, tell me what you'd like to do and I'll guide you through it.";
  }

  const hit = FAQ_RULES.find((rule) => rule.keys.some((key) => t.includes(key)));
  return hit?.reply || FALLBACK;
}
