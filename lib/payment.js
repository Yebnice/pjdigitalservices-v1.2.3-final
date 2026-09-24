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

    try {
      window.localStorage.setItem("pj_email", email);
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
      callback: function (response) {
        paymentCompleted = true;
        fetch("/api/orders/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: response.reference }),
        })
          .then((r) => r.json())
          .then((result) => {
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
            if (result.order) onDone(result.order, created.amount);
            else onError(`Payment ${result.status || "was not completed"}.`);
          })
          .catch((err) => onError(err.message));
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

        onError("Payment cancelled. No payment was completed.");
      },
    });
    handler.openIframe();
  } catch (err) {
    onError(err.message);
  }
}
