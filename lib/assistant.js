const FRIENDLY_SIGNOFF = "I'm here to help — just tell me what you need.";

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

export const FALLBACK = "I want to make sure I give you the right information. I can help with instant Airtime, instant Quick Data Top-up, data bundles, ECG, water, TV, AFA, result checkers, payments and order tracking. Tell me what you're trying to do, and I'll guide you.";

// Matched separately, BEFORE the keyword rules below, and only when the
// ENTIRE message is just a greeting.
const GREETING_ONLY = /^(hi+|hello+|hey+|hiya|yo|sup|good morning|good afternoon|good evening)[\s!.,]*$/i;
const GREETING_REPLY = "Hi! I'm Annette from PjDigitalServices. 😊 I'm happy to help with Airtime, Quick Data Top-up, other data bundles, bills, TV, AFA, result checkers, payments, or order tracking. What can I help you with today?";

export function faqReply(text) {
  const raw = String(text || "").trim();
  if (GREETING_ONLY.test(raw)) return GREETING_REPLY;
  const t = raw.toLowerCase();
  const hit = FAQ_RULES.find((rule) => rule.keys.some((key) => t.includes(key)));
  return hit?.reply || FALLBACK;
}
