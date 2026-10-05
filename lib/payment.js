import { priceDiffers, priceChangeMessage, DEFAULT_PRICE_TOLERANCE_GHS } from "./priceGuard";

// Answers from /api/orders/verify that retrying can never change.
const NOT_REAL_PAYMENT = ["test_mode_payment", "test_key_in_production", "reference_mismatch"];
const TERMINAL_REJECTIONS = ["amount_mismatch", "currency_mismatch", ...NOT_REAL_PAYMENT];

// Client-side only. Talks to our own API routes — never touches the
// Paystack secret key (that stays in lib/paystack.js on the server).
function makeIdempotencyKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `pj-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Only one checkout at a time per tab. Without this, a double-tap on "Pay" starts
// two orders and two payment popups. The timestamp lets a checkout that never
// reported back (closed tab-state, dropped script) expire instead of blocking forever.
let checkoutStartedAt = 0;
const CHECKOUT_STALE_MS = 15 * 60 * 1000;

export async function payAndFulfil({
  orderType,
  network,
  phone,
  email,
  bundleId,
  afaDetails,
  airtimeAmount,
  meterNumber,
  billAmount,
  tvDetails,
  checkerDetails,
  tierKey,
  size,
  rows,
  // The total the customer saw on the Pay button. If the server's real total
  // differs, the customer is asked before the payment popup opens.
  expectedAmount,
  expectedTolerance = DEFAULT_PRICE_TOLERANCE_GHS,
  onDone,
  onError,
}) {
  if (checkoutStartedAt && Date.now() - checkoutStartedAt < CHECKOUT_STALE_MS) {
    onError("A payment is already in progress. Please finish or close it first.");
    return;
  }
  checkoutStartedAt = Date.now();
  const finishDone = (...args) => {
    checkoutStartedAt = 0;
    return onDone(...args);
  };
  const finishError = (message) => {
    checkoutStartedAt = 0;
    return onError(message);
  };

  try {
    const idempotencyKey = makeIdempotencyKey();
    const payload = {
      orderType,
      network,
      phone,
      email,
      bundleId,
      afaDetails,
      airtimeAmount,
      meterNumber,
      billAmount,
      tvDetails,
      checkerDetails,
      tierKey,
      size,
      rows,
      idempotencyKey,
    };

    async function createOrderAttempt() {
      return fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
    }

    let createRes;
    try {
      createRes = await createOrderAttempt();
    } catch (firstError) {
      createRes = await createOrderAttempt();
    }
    // A gateway error can return an HTML page; don't surface "Unexpected token <".
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) throw new Error(created.error || "Could not start the order. Please try again in a moment.");

    // Price-shown guard: never open the payment popup for an amount the
    // customer has not seen. window.confirm is deliberately plain: it is
    // blocking, accessible, and works on every phone browser.
    if (priceDiffers(expectedAmount, created.amount, expectedTolerance)) {
      const accepted = typeof window !== "undefined" && typeof window.confirm === "function"
        && window.confirm(priceChangeMessage(expectedAmount, created.amount));
      if (!accepted) {
        try {
          fetch("/api/orders/abandon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: created.reference, email }),
            keepalive: true,
          }).catch(() => {});
        } catch {}
        finishError(`Payment not started: the price changed from GHS ${Number(expectedAmount).toFixed(2)} to GHS ${Number(created.amount).toFixed(2)}. Check the new price and try again.`);
        return;
      }
    }

    if (!window.PaystackPop) {
      throw new Error("Payment library is still loading — try again in a moment.");
    }

    try {
      window.sessionStorage.setItem("pj_email", email);
      window.localStorage.setItem("pj_last_reference", created.reference);
    } catch {}

    let paymentCompleted = false;
    let checkoutTerminal = false;

    const abandonUnpaidOrder = (message) => {
      if (checkoutTerminal || paymentCompleted) return;
      checkoutTerminal = true;
      try {
        fetch("/api/orders/abandon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: created.reference, email }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
      try {
        if (window.localStorage.getItem("pj_last_reference") === created.reference) {
          window.localStorage.removeItem("pj_last_reference");
        }
      } catch {}
      finishError(message);
    };

    const verifySuccessfulPayment = async (response) => {
      paymentCompleted = true;
      // The server-created order reference is authoritative. Never switch
      // verification to a callback-supplied reference.
      const reference = created.reference;
      const callbackReference = response?.reference || response?.trxref || null;
      try {
        window.localStorage.setItem("pj_last_reference", reference);
      } catch {}

      let result = null;
      let rejectedStatus = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const verifyRes = await fetch("/api/orders/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference, email }),
          });
          const body = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok || verifyRes.status === 202) {
            result = body;
            break;
          }
          // The payment went through but was refused (e.g. the amount didn't
          // match the order). Retrying can't change that, so stop and say so.
          if (verifyRes.status === 400 && TERMINAL_REJECTIONS.includes(body?.status)) {
            rejectedStatus = body.status;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, Math.min(2500, 750 * attempt)));
      }

      if (result?.order) {
        checkoutTerminal = true;
        try {
          window.localStorage.setItem("pj_last_reference", result.order.reference);
        } catch {}
        finishDone(result.order, created.amount);
        return;
      }

      if (rejectedStatus && NOT_REAL_PAYMENT.includes(rejectedStatus)) {
        finishError(`This payment was not a real, live payment (it was made in test mode), so no money was taken and nothing was delivered. If your account or mobile money was charged, contact support with reference ${reference}.`);
        return;
      }

      if (rejectedStatus) {
        const orderNo = result?.order?.orderNo || null;
        if (["amount_mismatch", "currency_mismatch"].includes(rejectedStatus)) {
          finishError(`We received your payment, but the payment did not cover the service amount, so nothing was delivered. Please do not pay again. Contact support with order number ${orderNo || reference}.`);
          return;
        }
        finishError(`The payment could not be verified, so nothing was delivered. Please do not pay again. Contact support with order number ${orderNo || reference}.`);
        return;
      }

      finishError(`Payment confirmation was received, but we could not complete the status check yet. Your order reference is ${reference}. Please use Track Order or contact support if it remains pending.`);
    };

    const popup = new window.PaystackPop();
    popup.newTransaction({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round((created.paymentAmount ?? created.amount) * 100),
      currency: "GHS",
      reference: created.reference,
      metadata: { orderType, network, phone },
      onSuccess: function (response) {
        if (response?.reference && response.reference !== created.reference) {
          console.warn("Paystack callback reference differed from server-created order reference", {
            orderReference: created.reference,
            callbackReference: response.reference,
          });
        }
        void verifySuccessfulPayment(response);
      },
      onCancel: function () {
        abandonUnpaidOrder("Payment cancelled. No payment was completed.");
      },
      onError: function (error) {
        const detail = String(error?.message || "Payment checkout could not be loaded.");
        abandonUnpaidOrder(`${detail} Please try again.`);
      },
    });
  } catch (err) {
    finishError(err.message);
  }
}
