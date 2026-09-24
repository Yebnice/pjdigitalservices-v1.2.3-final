import { TIERS } from './agentProducts';

function textEscape(value) {
  return String(value || '').replace(/[<>]/g, '');
}

async function sendResendEmail({ to, subject, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  const replyTo = process.env.SUPPORT_REPLY_TO_EMAIL;
  if (!apiKey || !from || !to) return { sent: false, skipped: true };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notification email failed: ${response.status} ${body.slice(0, 500)}`);
  }
  return { sent: true };
}

export async function notifyAdminManualReview(order) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return { sent: false, skipped: true };
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const text = [
    'PjDigitalServices — Manual Review Required',
    '',
    `Order: ${textEscape(order.reference)}`,
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    `Payment: ${textEscape(order.status)}`,
    `Fulfillment: ${textEscape(order.fulfillmentStatus)}`,
    `Detected: ${order.processingStartedAt ? new Date(order.processingStartedAt).toLocaleString() : new Date().toLocaleString()}`,
    '',
    'Reason: fulfillment remained unresolved beyond the configured safety threshold.',
    '',
    'Please confirm the provider outcome before any further fulfillment attempt. Do not blindly retry an uncertain digital-value transaction because it may cause duplicate delivery.',
    '',
    `Admin dashboard: ${baseUrl}/admin`,
  ].join('\n');
  return sendResendEmail({ to: adminEmail, subject: `PjDigitalServices alert — ${order.reference} requires manual review`, text, idempotencyKey: `manual-review/${order.reference}` });
}

// New complaint/feedback submissions previously had NO notification at
// all — they saved silently and only ever surfaced if an admin happened to
// open the dashboard's Feedback tab and look. This is the fix.
export async function notifyAdminNewFeedback(entry) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return { sent: false, skipped: true };
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const text = [
    'PjDigitalServices — New Complaint/Feedback',
    '',
    `Case: ${textEscape(entry.caseReference)}`,
    `From: ${textEscape(entry.name)} (${[entry.email, entry.phone].filter(Boolean).map(textEscape).join(' · ') || 'no contact given'})`,
    `Category: ${textEscape(entry.category || 'general')} · Service: ${textEscape(entry.serviceType || '—')}`,
    entry.orderReference ? `Order reference: ${textEscape(entry.orderReference)}` : null,
    '',
    `Message: ${textEscape(entry.message)}`,
    '',
    `Admin dashboard: ${baseUrl}/admin`,
  ].filter((line) => line !== null).join('\n');
  return sendResendEmail({ to: adminEmail, subject: `New feedback — ${entry.caseReference}`, text, idempotencyKey: `new-feedback/${entry.caseReference}` });
}

export async function notifyCustomerVerifyEmail({ email, name, token }) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const link = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const text = [
    `Hi ${textEscape(name)},`,
    '',
    'Thanks for creating a PjDigitalServices account. Click the link below to verify your email and activate your account:',
    '',
    link,
    '',
    'This link expires in 24 hours. If you did not create this account, you can ignore this email.',
  ].join('\n');
  return sendResendEmail({ to: email, subject: 'Verify your PjDigitalServices account', text, idempotencyKey: `verify-email/${token}` });
}

export async function notifyCustomerPasswordReset({ email, name, token }) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const text = [
    `Hi ${textEscape(name)},`,
    '',
    'We received a request to reset your PjDigitalServices password. Click the link below to choose a new one:',
    '',
    link,
    '',
    'This link expires in 1 hour. If you did not request this, you can ignore this email — your password will not change.',
  ].join('\n');
  return sendResendEmail({ to: email, subject: 'Reset your PjDigitalServices password', text, idempotencyKey: `reset-password/${token}` });
}

export async function notifyCustomerProcessingDelay(order) {
  if (!order?.email) return { sent: false, skipped: true };
  const text = [
    'PjDigitalServices — Order Update',
    '',
    `Your order ${textEscape(order.reference)} is still being processed.`,
    '',
    'We are sorry for the delay. Please do not place a duplicate order while we complete the processing of your request.',
    '',
    'You can check the latest status from the My Orders / Track Order page using your order reference and checkout email.',
  ].join('\n');
  return sendResendEmail({ to: order.email, subject: `Your PjDigitalServices order ${order.reference} is still processing`, text, idempotencyKey: `processing-delay/${order.reference}` });
}

const ORDER_TYPE_LABELS = {
  airtime: 'Airtime top-up',
  data: 'Data bundle',
  tierData: 'Data bundle',
  tierBulkData: 'Bulk data bundles',
  tierBulkAirtime: 'Bulk airtime top-up',
  afa: 'AFA registration',
  ecg: 'Electricity bill (ECG)',
  water: 'Water bill',
  tv: 'TV subscription',
  checker: 'Result checker',
};

// The one gap in the notification set: previously nothing ever confirmed a
// successful, on-time delivery to the customer — only a delay/apology email
// existed. For the normal happy path (the vast majority of orders), the
// customer got no direct confirmation their purchase actually went through.
// Sent instead of the "Delivered" email until Techlink's own verify-status
// endpoint (or an admin) actually confirms completion. Being upfront about
// the delay here is the whole fix: no premature "Delivered!" claim, no
// eroded trust.
//
// Three different situations land in "queued", and they are NOT the same
// wait for the customer — see fulfillClaimedOrder in orderProcessing.js:
//   - delayed tier only (e.g. a single MTN Master order): Techlink
//     documents this as genuinely non-instant, ~30 min to a few hours.
//     That ETA is a real, known fact — say it.
//   - unconfirmed bulk batch on an otherwise-instant tier (AT iShare,
//     Telecel Group Share, MTN Express, or MTN Master's own bulk/Excel
//     mode): Techlink accepted the batch but we don't have per-row
//     confirmation yet, so a human checks with Techlink before we call it
//     delivered. There is no known ETA for that — quoting "30 minutes to
//     a few hours" is just wrong here, and a customer who takes it
//     literally and waits past it will read the silence as something
//     being broken.
//   - BOTH at once (a bulk/Excel MTN Master order): it genuinely carries
//     the tier's own delivery window AND still needs the batch confirmed
//     row-by-row. Dropping the tier's known ETA here would throw away
//     real information the customer could use; dropping the "we're
//     manually confirming the batch" part would imply a false precision
//     the bulk case doesn't have. Say both.
export async function notifyCustomerOrderQueued(order) {
  if (!order?.email) return { sent: false, skipped: true };
  const isBulk = order.orderType === 'tierBulkData' || order.orderType === 'tierBulkAirtime';
  const tier = TIERS[order.tierDetails?.tierKey];
  const isDelayedTier = tier?.instant === false;
  const label = ORDER_TYPE_LABELS[order.orderType] || 'order';

  let intro;
  if (isBulk && isDelayedTier) {
    intro = `Because this is a bulk ${tier.label} order, two things apply: ${tier.label} bundles are our non-instant tier (typically 30 minutes to a few hours per delivery), and for bulk batches we also confirm with the provider that every recipient went through before marking the order complete. That confirmation step has no fixed ETA on top of the tier's own delay, but most batches are confirmed the same day.`;
  } else if (isBulk) {
    intro = "Because this is a bulk order, we're confirming with the provider that every recipient in the batch was actually delivered before we mark it complete — that's a manual check on our side, not an automatic queue, so it doesn't run on a fixed timer. Most batches are confirmed the same day.";
  } else {
    intro = 'This bundle typically arrives within 30 minutes to a few hours (sometimes longer if the queue is busy) — this is normal for this option, not an error on your order.';
  }

  const text = [
    'PjDigitalServices — Order Received',
    '',
    isBulk
      ? `Your ${label.toLowerCase()} order ${textEscape(order.reference)} has been submitted.`
      : `Your order ${textEscape(order.reference)} has been queued for delivery.`,
    '',
    intro,
    '',
    `Order: ${textEscape(order.reference)}`,
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    '',
    isBulk
      ? "We'll email you the moment it's confirmed delivered, so there's nothing you need to do. If you'd like a hand anyway, reach us via the Feedback page or support@pjdigitalservices.online with this order reference and we'll check on it personally."
      : "We'll email you again once it's actually delivered. If it hasn't arrived after several hours, let us know via the Feedback page or support@pjdigitalservices.online with this order reference.",
  ].join('\n');

  const subject = isBulk
    ? `Order received — ${order.reference} is being confirmed`
    : `Order received — ${order.reference} is queued for delivery`;
  return sendResendEmail({ to: order.email, subject, text, idempotencyKey: `queued/${order.reference}` });
}

export async function notifyCustomerOrderFulfilled(order) {
  if (!order?.email) return { sent: false, skipped: true };
  const label = ORDER_TYPE_LABELS[order.orderType] || 'Order';
  const recipientLine = order.phone && order.phone !== '—' && !String(order.phone).includes('recipients')
    ? `Recipient: ${textEscape(order.phone)}`
    : null;
  // Result-checker orders (voucher purchase AND the paid lookup service —
  // see lib/techlink.js fulfillOrder's "checker" case) are the one product
  // where the thing being sold IS the data in the response, not just a
  // confirmation that something happened elsewhere on a phone line. Without
  // this block, this email said "delivered" and never actually included the
  // serial/PIN — see the comment on sanitizePublicResult in lib/store.js for
  // why nothing else in the app was going to deliver it either. Techlink's
  // own "deliveryMethod" field on the purchase request cannot reach the
  // customer (the request never carries their email/phone), so this app
  // relaying the code here is the only channel that actually gets it to them.
  const checkers = Array.isArray(order.result?.checkers) ? order.result.checkers : [];
  const checkerLines = checkers.length
    ? [
        '',
        checkers.length === 1 ? 'Your voucher:' : `Your ${checkers.length} vouchers:`,
        ...checkers.map((c, i) => `${checkers.length > 1 ? `${i + 1}. ` : ''}${textEscape(c.type || '')} — Serial: ${textEscape(c.serialNumber || '—')}  PIN: ${textEscape(c.pin || '—')}`),
      ]
    : [];
  const text = [
    'PjDigitalServices — Order Delivered',
    '',
    `Your ${label.toLowerCase()} has been delivered.`,
    '',
    `Order: ${textEscape(order.reference)}`,
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    recipientLine,
    ...checkerLines,
    '',
    'Thanks for choosing PjDigitalServices. If anything looks off with this order, let us know via the Feedback page or by emailing support@pjdigitalservices.online — include this order reference either way.',
    // `.filter(Boolean)` here used to strip every intentional blank-line
    // spacer along with the one thing it was meant to remove
    // (recipientLine when null) — '' is falsy too, so this email has been
    // going out with no blank lines between sections at all. Filtering
    // only actual null/undefined entries keeps the null-conditional line
    // out while leaving the spacers alone.
  ].filter((line) => line != null).join('\n');
  return sendResendEmail({
    to: order.email,
    subject: `Delivered — your PjDigitalServices order ${order.reference}`,
    text,
    idempotencyKey: `fulfilled/${order.reference}`,
  });
}


function cleanPhone(value) {
  // Brevo's transactionalSMS/send endpoint wants digits (+ country code) with
  // no leading "+" and no whitespace/formatting characters.
  let digits = String(value || '').replace(/\s+/g, '').replace(/^\+/, '');
  // Customers type Ghanaian numbers the normal local way — e.g. 0509909793 —
  // but Brevo requires the full country code (233509909793), not the local
  // leading 0. Without this, every customer SMS silently fails to a number
  // Brevo doesn't recognize as valid, while admin's own ADMIN_SMS_TO (set
  // directly in an env var, already in 233... format) was never affected.
  if (/^0\d{9}$/.test(digits)) digits = '233' + digits.slice(1);
  return digits;
}

async function sendBrevoSms({ to, sender, content, idempotencyKey }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || !to || !sender) return { sent: false, skipped: true };
  const recipient = cleanPhone(to);
  if (!/^\d{6,15}$/.test(recipient)) {
    // Fail loudly rather than silently mis-sending: a malformed ADMIN_SMS_TO
    // is a config error, not a "channel not configured" situation.
    throw new Error(`Brevo SMS notification failed: ADMIN_SMS_TO is not a valid E.164-style number (${recipient.length} digits)`);
  }
  const response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: String(sender).slice(0, 11),
      recipient,
      content: String(content).slice(0, 918), // ~6 concatenated SMS segments; Brevo splits automatically past 160 chars
      type: 'transactional', // non-promotional alert: no quiet-hours throttling, no STOP-code requirement
      tag: 'urgent-manual-review',
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo SMS notification failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return { sent: true, idempotencyKey };
}

// Customer SMS confirmation — the one channel that never existed at all
// before now (only the email confirmation from earlier existed, and only
// the admin got SMS alerts). Skips silently for bulk orders, where
// order.phone is a placeholder like "5 recipients" rather than a single
// number to text, and for anything else without a real phone on file.
export async function notifyCustomerOrderSms(order) {
  const phone = order?.phone;
  if (!phone || phone === '—' || /recipient/i.test(String(phone))) return { sent: false, skipped: true };
  const label = ORDER_TYPE_LABELS[order.orderType] || 'Order';
  const content = `PjDigitalServices: Your ${label.toLowerCase()} (GHS ${Number(order.amount || 0).toFixed(2)}) was delivered. Ref: ${order.reference}. Thank you!`;
  return sendBrevoSms({
    to: phone,
    sender: process.env.BREVO_SMS_SENDER || 'PjDigital',
    content,
    idempotencyKey: `customer-delivered-sms/${order.reference}`,
  });
}

export async function notifyAdminEscalation(order, channel) {
  const text = [
    'PjDigitalServices — URGENT Manual Review',
    '',
    `Order: ${textEscape(order.reference)}`,
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    'Status: Paid / fulfillment requires provider confirmation.',
    '',
    'Do not retry until the provider outcome is confirmed.',
  ].join('\n');

  if (channel === 'email') {
    // Second, independent escalation channel (replaces the old WhatsApp leg).
    // Reuses the existing Resend integration rather than adding a second
    // email provider on top of Brevo.
    const adminEmail = process.env.ADMIN_ALERT_EMAIL;
    if (!adminEmail) return { sent: false, skipped: true };
    return sendResendEmail({
      to: adminEmail,
      subject: `URGENT — order ${order.reference} still needs manual review`,
      text,
      idempotencyKey: `urgent-review-email/${order.reference}`,
    });
  }

  return sendBrevoSms({
    to: process.env.ADMIN_SMS_TO,
    sender: process.env.BREVO_SMS_SENDER || 'PjDigital',
    content: text,
    idempotencyKey: `urgent-review-sms/${order.reference}`,
  });
}

// Fires when the Techlink wallet balance drops below
// TECHLINK_LOW_BALANCE_THRESHOLD (see checkTechlinkWalletBalance in
// lib/orderProcessing.js, called from /api/jobs/fulfill). This is the
// PROACTIVE counterpart to notifyAdminManualReview/notifyAdminEscalation
// above — those fire reactively, after an order has already failed and
// exhausted its retries; this fires as soon as the balance itself is low,
// so the admin can top up before a single customer is affected. Sent on
// both channels (like the urgent escalation) since this blocks EVERY
// order behind it, not just one.
export async function notifyAdminLowBalance(balance, threshold) {
  const text = [
    'PjDigitalServices — LOW TECHLINK WALLET BALANCE',
    '',
    `Current balance: GHS ${Number(balance).toFixed(2)}`,
    `Alert threshold: GHS ${Number(threshold).toFixed(2)}`,
    '',
    'Every order (airtime, data, ECG, water, TV, AFA, checkers) debits this',
    'wallet. Top it up now — customers are already being charged by Paystack',
    'successfully, but their orders will keep failing at the Techlink step',
    'until this balance is restored.',
  ].join('\n');

  // Each channel is attempted independently (same rule as the urgent
  // escalation path in orderProcessing.js): a Resend failure must never
  // stop the SMS from going out, and vice versa. Previously the email was
  // awaited first and a throw there skipped the SMS entirely.
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  const bucket = new Date().toISOString().slice(0, 13);
  let emailResult = { sent: false, skipped: true };
  let smsResult = { sent: false, skipped: true };
  const errors = [];

  if (adminEmail) {
    try {
      emailResult = await sendResendEmail({
        to: adminEmail,
        subject: `LOW BALANCE — Techlink wallet is at GHS ${Number(balance).toFixed(2)}`,
        text,
        // Keyed by a coarse hour bucket (there is no per-order reference)
        // so a retried cron run in the same hour can't double-send.
        idempotencyKey: `low-balance-email/${bucket}`,
      });
    } catch (err) {
      errors.push(err.message);
    }
  }

  try {
    smsResult = await sendBrevoSms({
      to: process.env.ADMIN_SMS_TO,
      sender: process.env.BREVO_SMS_SENDER || 'PjDigital',
      content: text,
      idempotencyKey: `low-balance-sms/${bucket}`,
    });
  } catch (err) {
    errors.push(err.message);
  }

  // `sent` is true only if at least one channel actually delivered — the
  // caller uses this to decide whether to start the alert cooldown.
  return { sent: Boolean(emailResult?.sent || smsResult?.sent), email: emailResult, sms: smsResult, errors };
}


// A queued (non-instant / unconfirmed) order has waited longer than
// QUEUED_ALERT_MINUTES. Bulk orders can never auto-resolve (Techlink's bulk
// endpoints return no order id to check), so without this an admin would only
// notice by opening the dashboard. Each channel is tried independently.
export async function notifyAdminStaleQueued(order, waitedMinutes) {
  const isBulk = order.orderType === 'tierBulkData' || order.orderType === 'tierBulkAirtime';
  const text = [
    'PjDigitalServices — Queued order needs a check',
    '',
    `Order: ${textEscape(order.reference)}`,
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    `Waiting: over ${Math.round(waitedMinutes)} minutes with no confirmed delivery.`,
    '',
    isBulk
      ? 'This is a BULK order, which cannot be checked automatically. Confirm delivery with Techlink, then use "Mark fulfilled manually" in the admin dashboard.'
      : 'Techlink has not reported this order as completed. Check it in the admin dashboard.',
    '',
    'Do not retry a bulk order until you have confirmed which recipients received it.',
  ].join('\n');

  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  let emailResult = { sent: false, skipped: true };
  let smsResult = { sent: false, skipped: true };
  const errors = [];
  if (adminEmail) {
    try {
      emailResult = await sendResendEmail({
        to: adminEmail,
        subject: `Queued order ${order.reference} has been waiting a long time`,
        text,
        idempotencyKey: `stale-queued-email/${order.reference}`,
      });
    } catch (err) {
      errors.push(err.message);
    }
  }
  try {
    smsResult = await sendBrevoSms({
      to: process.env.ADMIN_SMS_TO,
      sender: process.env.BREVO_SMS_SENDER || 'PjDigital',
      content: text,
      idempotencyKey: `stale-queued-sms/${order.reference}`,
    });
  } catch (err) {
    errors.push(err.message);
  }
  return { sent: Boolean(emailResult?.sent || smsResult?.sent), email: emailResult, sms: smsResult, errors };
}
