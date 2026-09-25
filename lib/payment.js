// Client-side only. Talks to our own API routes — never touches the
// Paystack secret key (that stays in lib/paystack.js on the server).
function makeIdempotencyKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `pj-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

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
  onDone,
  onError,
}) {
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
      // Retry a network-level failure with the SAME key. If the server created
      // the order but the response was lost, the unique key returns the
      // existing order rather than creating a second payment reference.
      createRes = await createOrderAttempt();
    }
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error || "Could not start order");

    if (!window.PaystackPop) {
      throw new Error("Payment library is still loading — try again in a moment.");
    }

    // Keep the email for checkout convenience. Save the order reference before
    // verification so a transient verification/network failure never leaves a
    // successfully charged customer without a way to track the order.
    try {
      window.sessionStorage.setItem("pj_email", email);
      window.localStorage.setItem("pj_last_reference", created.reference);
    } catch {}

    let paymentCompleted = false;

    const handler = window.PaystackPop.setup({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round(created.amount * 100), // pesewas
      currency: "GHS",
      ref: created.reference,
      metadata: { orderType, network, phone },
      callback: async function (response) {
        paymentCompleted = true;
        try {
          window.localStorage.setItem("pj_last_reference", response.reference || created.reference);
        } catch {}

        let result = null;
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const verifyRes = await fetch("/api/orders/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reference: response.reference || created.reference }),
            });
            const body = await verifyRes.json().catch(() => ({}));
            // BUG FIX: this used to only accept 200/202 as "got a result" and
            // treat everything else — including a definitive 400 "failed"
            // response from /api/orders/verify (declined card, amount/currency
            // mismatch) — as a transient error worth retrying. That meant a
            // genuinely failed payment burned all 3 retries against the SAME
            // 400 response, `result` was never set, and the customer ended up
            // in the `else` branch below with a misleading "we could not
            // complete the status check yet... check back later" message —
            // instead of the honest "Payment declined/failed." the code below
            // was clearly written to show (see `result.status` handling).
            // Only genuinely transient responses (429 rate limit, 5xx) should
            // be retried; 400/404/200/202 are all definitive answers.
            if (verifyRes.status === 429 || verifyRes.status >= 500) {
              lastError = new Error(body.error || "Could not verify payment");
            } else {
              result = body;
              break;
            }
          } catch (err) {
            lastError = err;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(2500, 750 * attempt)));
        }

        if (result) {
            // BUG FIX: this used to branch on result.status === "success"
            // only. Every other outcome — including a payment that
            // succeeded but where Techlink fulfillment failed right after
            // (e.g. YOUR Techlink wallet running dry — a real incident:
            // customer charged, airtime not delivered) — fell into
            // onError() with a bare "Payment processing." toast and NO
            // order reference, even though the charge had already gone
            // through and the order was safely queued for automatic
            // retry (see listReadyOrders / promoteExhaustedFailedOrders
            // in lib/store.js — that retry logic was already correct).
            // The customer had no way to know they'd been charged or how
            // to follow up. The presence of `order` in the response is
            // what actually tells you the charge succeeded — verify.js
            // only omits `order` for a genuine payment failure (txn
            // declined, amount/currency mismatch), where nothing was
            // charged and a plain error is correct.
            if (result.order) {
              try {
                window.localStorage.setItem("pj_last_reference", result.order.reference);
              } catch {}
              onDone(result.order, created.amount);
            } else {
              try {
                if (window.localStorage.getItem("pj_last_reference") === created.reference) {
                  window.localStorage.removeItem("pj_last_reference");
                }
              } catch {}
              // Now actually reachable (see the retry-loop fix above) for a
              // genuinely failed/declined/mismatched payment. Map the internal
              // status codes to something a customer can act on instead of
              // showing the raw code (e.g. "Payment amount_mismatch.").
              const FRIENDLY_STATUS = {
                amount_mismatch: "the charged amount did not match your order",
                currency_mismatch: "the payment was not in Ghana Cedis (GHS)",
                declined: "your card or mobile money was declined",
                abandoned: "the payment was not completed",
                reversed: "the payment was reversed",
                cancelled: "the payment was cancelled",
                canceled: "the payment was cancelled",
              };
              const reason = FRIENDLY_STATUS[result.status] || "your payment could not be completed";
              onError(`Payment failed — ${reason}. No product was delivered. Please try again, or contact support with reference ${created.reference} if you were charged.`);
            }
        } else {
          onError(`Payment confirmation was received, but we could not complete the status check yet. Your order reference is ${response.reference || created.reference}. Please use Track Order or contact support if it remains pending.`);
        }
      },
      onClose: function () {
        if (paymentCompleted) return;
        // The order is created before Paystack opens, so closing the popup
        // used to leave an unpaid "pending" order behind. Record the
        // cancellation only after the server checks Paystack, protecting
        // against a race where payment actually succeeded.
        try {
          fetch("/api/orders/abandon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: created.reference }),
            keepalive: true,
          }).catch(() => {});
        } catch {}

        // A cancelled checkout must never remain as the device's last
        // successful order.
        try {
          if (window.localStorage.getItem("pj_last_reference") === created.reference) {
            window.localStorage.removeItem("pj_last_reference");
          }
        } catch {}

        onError("Payment cancelled. No payment was completed.");
      },
    });
    handler.openIframe();
  } catch (err) {
    onError(err.message);
  }
}
