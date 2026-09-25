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
      createRes = await createOrderAttempt();
    }
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error || "Could not start order");

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
          body: JSON.stringify({ reference: created.reference }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
      try {
        if (window.localStorage.getItem("pj_last_reference") === created.reference) {
          window.localStorage.removeItem("pj_last_reference");
        }
      } catch {}
      onError(message);
    };

    const verifySuccessfulPayment = async (response) => {
      paymentCompleted = true;
      const reference = response?.reference || response?.trxref || created.reference;
      try {
        window.localStorage.setItem("pj_last_reference", reference);
      } catch {}

      let result = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const verifyRes = await fetch("/api/orders/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference }),
          });
          const body = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok || verifyRes.status === 202) {
            result = body;
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
        onDone(result.order, created.amount);
        return;
      }

      onError(`Payment confirmation was received, but we could not complete the status check yet. Your order reference is ${reference}. Please use Track Order or contact support if it remains pending.`);
    };

    const popup = new window.PaystackPop();
    popup.newTransaction({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round(created.amount * 100),
      currency: "GHS",
      reference: created.reference,
      metadata: { orderType, network, phone },
      onSuccess: function (response) {
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
    onError(err.message);
  }
}
