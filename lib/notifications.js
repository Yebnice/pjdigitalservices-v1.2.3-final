import { extractVouchers, isVoucherOrder } from './vouchers';
import crypto from 'crypto';

// Absolute site URL used in emailed links. Falls back to Vercel's own URL when
// NEXT_PUBLIC_SITE_URL is unset (a relative link in an email can't be clicked),
// and never produces an http:// link in production, since verification and
// password-reset links carry secret tokens.
function siteBaseUrl() {
  let raw = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (!raw && process.env.VERCEL_PROJECT_PRODUCTION_URL) raw = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (!raw && process.env.VERCEL_URL) raw = `https://${process.env.VERCEL_URL}`;
  raw = raw.replace(/\/+$/, '');
  if (raw && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  if (process.env.NODE_ENV === 'production') raw = raw.replace(/^http:\/\//i, 'https://');
  return raw;
}

function textEscape(value) {
  return String(value || '').replace(/[<>]/g, '');
}

// The number a customer sees on the website and on their receipt is OUR order
// number (PJ-XXXXXXXX). Emails and SMS must use the same one, with the Paystack
// reference alongside it for anyone matching a bank or mobile-money statement.
// Orders created before the order-number migration only have a reference.
function orderNumber(order) {
  return textEscape(order?.orderNo || order?.reference);
}
function orderIdLines(order) {
  const no = order?.orderNo;
  const ref = order?.reference;
  if (no && ref && no !== ref) return [`Order number: ${textEscape(no)}`, `Paystack reference: ${textEscape(ref)}`];
  return [`Order: ${orderNumber(order)}`];
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
  const baseUrl = siteBaseUrl();
  const text = [
    'PjDigitalServices — Manual Review Required',
    '',
    ...orderIdLines(order),
    `Amount: GHS ${Number(order.amount || 0).toFixed(2)}`,
    `Payment: ${textEscape(order.status)}`,
    `Fulfillment: ${textEscape(order.fulfillmentStatus)}`,
    `Detected: ${order.processingStartedAt ? new Date(order.processingStartedAt).toLocaleString() : new Date().toLocaleString()}`,
    '',
    // The real reason, when the app recorded one (e.g. a Techlink error); the old fixed
    // sentence was wrong for any order that was held on purpose.
    `Reason: ${textEscape(order.lastFulfillmentError) || 'fulfillment remained unresolved beyond the configured safety threshold.'}`,
    '',
    'Please confirm the provider outcome before any further fulfillment attempt. Do not blindly retry an uncertain digital-value transaction because it may cause duplicate delivery.',
    '',
    `Admin dashboard: ${baseUrl}/admin`,
  ].join('\n');
  return sendResendEmail({ to: adminEmail, subject: `PjDigitalServices alert — ${orderNumber(order)} requires manual review`, text, idempotencyKey: `manual-review/${order.reference}` });
}

// New complaint/feedback submissions previously had NO notification at
// all — they saved silently and only ever surfaced if an admin happened to
// open the dashboard's Feedback tab and look. This is the fix.
export async function notifyAdminNewFeedback(entry) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return { sent: false, skipped: true };
  const baseUrl = siteBaseUrl();
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
  const baseUrl = siteBaseUrl();
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
  const baseUrl = siteBaseUrl();
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
    `Your order ${orderNumber(order)} is still being processed.`,
    '',
    'We are sorry for the delay. Please do not place a duplicate order while we complete the processing of your request.',
    '',
    ...orderIdLines(order),
    '',
    'You can check the latest status from the My Orders / Track Order page using your order number and checkout email.',
  ].join('\n');
  return sendResendEmail({ to: order.email, subject: `Your PjDigitalServices order ${orderNumber(order)} is still processing`, text, idempotencyKey: `processing-delay/${order.reference}` });
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
// For tiers Techlink documents as non-instant (MTN Master) — sent instead
// of the "Delivered" email until Techlink's own verify-status endpoint
// actually confirms completion. Being upfront about the delay here is the
// whole fix: no premature "Delivered!" claim, no eroded trust.
export async function notifyCustomerOrderQueued(order) {
  if (!order?.email) return { sent: false, skipped: true };
  const totalPaid = Number(order.checkoutAmount ?? order.customerProductAmount ?? order.amount ?? 0);
  const text = [
    'PjDigitalServices — Order Received',
    '',
    `Your order ${orderNumber(order)} has been queued for delivery.`,
    '',
    'This bundle typically arrives within 30 minutes to a few hours (sometimes longer if the queue is busy) — this is normal for this option, not an error on your order.',
    '',
    ...orderIdLines(order),
    `Total paid: GHS ${totalPaid.toFixed(2)}`,
    '',
    "We'll email you again once it's actually delivered. If it hasn't arrived after several hours, let us know via the Feedback page or support@pjdigitalservices.online with this order number.",
  ].join('\n');
  return sendResendEmail({ to: order.email, subject: `Order received — ${orderNumber(order)} is queued for delivery`, text, idempotencyKey: `queued/${order.reference}` });
}

// The customer paid for specific voucher serial numbers and PINs. Techlink's purchase
// request has no recipient field, so the app is the only party that can hand them over.
function voucherLines(order) {
  const vouchers = extractVouchers(order?.result);
  if (!vouchers.length) return [];
  return [
    'Your voucher details (keep them private):',
    ...vouchers.map((v, i) => `${i + 1}. ${v.type || 'Checker'}   Serial: ${v.serialNumber}   PIN: ${v.pin}`),
    '',
  ];
}

export async function notifyCustomerOrderFulfilled(order) {
  if (!order?.email) return { sent: false, skipped: true };
  const label = ORDER_TYPE_LABELS[order.orderType] || 'Order';
  const recipientLine = order.phone && order.phone !== '—' && !String(order.phone).includes('recipients')
    ? `Recipient: ${textEscape(order.phone)}`
    : null;
  const totalPaid = Number(order.checkoutAmount ?? order.customerProductAmount ?? order.amount ?? 0);
  const text = [
    'PjDigitalServices — Order Delivered',
    '',
    `Your ${label.toLowerCase()} has been delivered.`,
    '',
    ...voucherLines(order),
    ...orderIdLines(order),
    `Total paid: GHS ${totalPaid.toFixed(2)}`,
    recipientLine,
    '',
    'Thanks for choosing PjDigitalServices. If anything looks off with this order, let us know via the Feedback page or by emailing support@pjdigitalservices.online — include this order number either way.',
  ].filter(Boolean).join('\n');
  return sendResendEmail({
    to: order.email,
    subject: `Delivered — your PjDigitalServices order ${orderNumber(order)}`,
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
// One short SMS per voucher (serial + PIN), so each fits a single 160-character message.
async function notifyCustomerVoucherSms(order) {
  const vouchers = extractVouchers(order?.result);
  if (!vouchers.length) return { sent: false, skipped: true };
  let sent = 0;
  for (const [i, v] of vouchers.entries()) {
    const content = `PjDigital ${v.type || 'Checker'} ${i + 1}/${vouchers.length}: Serial ${v.serialNumber} PIN ${v.pin}. Order ${orderNumber(order)}`;
    const r = await sendBrevoSms({ to: order.phone, sender: process.env.BREVO_SMS_SENDER || 'PjDigital', content, idempotencyKey: `customer-voucher-sms/${order.reference}/${i}` });
    if (r?.sent) sent += 1;
  }
  return { sent: sent > 0, count: sent };
}

export async function notifyCustomerOrderSms(order) {
  const phone = order?.phone;
  if (!phone || phone === '—' || /recipient/i.test(String(phone))) return { sent: false, skipped: true };
  if (isVoucherOrder(order)) {
    // A voucher customer who chose email gets it by email; one who chose SMS gets the PIN(s) by SMS.
    return order.checkerDetails?.deliveryMethod === 'sms' ? notifyCustomerVoucherSms(order) : { sent: false, skipped: true };
  }
  const label = ORDER_TYPE_LABELS[order.orderType] || 'Order';
  const totalPaid = Number(order.checkoutAmount ?? order.customerProductAmount ?? order.amount ?? 0);
  const content = `PjDigitalServices: Your ${label.toLowerCase()} (GHS ${totalPaid.toFixed(2)} total paid) was delivered. Order: ${orderNumber(order)}. Thank you!`;
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

// ---------------------------------------------------------------------------
// Held orders are a QUEUE, not an incident. Paid orders the app deliberately did not
// send (manual mode, found late, found by a check) produce ONE digest, not one email and
// two SMS each. Real incidents (a Techlink failure) still alert per order.
// ---------------------------------------------------------------------------
function heldAge(order) {
  const t = new Date(order.manualReviewAt || order.createdAt).getTime();
  const h = Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 3600000) : 0;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toFixed(1)} h`;
}

export async function notifyAdminHeldDigest(orders, { urgent = false } = {}) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail || !orders?.length) return { sent: false, skipped: true };
  const label = (o) => ORDER_TYPE_LABELS[o.orderType] || o.orderType || 'Order';
  const shown = orders.slice(0, 25);
  const lines = shown.map((o) => `- ${orderNumber(o)} | ${label(o)} | GHS ${Number(o.checkoutAmount ?? o.amount ?? 0).toFixed(2)} | waiting ${heldAge(o)} | ${textEscape(String(o.lastFulfillmentError || 'held for approval')).slice(0, 110)}`);
  const text = [
    urgent ? 'PjDigitalServices — URGENT: paid orders still waiting for approval' : 'PjDigitalServices — paid orders waiting for your approval',
    '',
    `${orders.length} order${orders.length === 1 ? ' is' : 's are'} PAID but the app deliberately did NOT send ${orders.length === 1 ? 'it' : 'them'} to Techlink. Nothing has been spent.`,
    'Each line shows why. Review them under Admin, Needs attention, "Paid - awaiting your approval", then press Approve & deliver on the ones you want sent.',
    '',
    ...lines,
    orders.length > shown.length ? `...and ${orders.length - shown.length} more.` : null,
    '',
    `Admin dashboard: ${siteBaseUrl()}/admin`,
  ].filter((l) => l !== null).join('\n');
  const key = crypto.createHash('sha256').update(orders.map((o) => o.reference).sort().join(',')).digest('hex').slice(0, 16);
  return sendResendEmail({
    to: adminEmail,
    subject: `${urgent ? 'URGENT — ' : ''}${orders.length} paid order${orders.length === 1 ? '' : 's'} waiting for your approval`,
    text,
    idempotencyKey: `held-digest/${urgent ? 'urgent' : 'new'}/${key}`,
  });
}

export async function notifyAdminHeldUrgentSms(orders) {
  if (!process.env.ADMIN_SMS_TO || !orders?.length) return { sent: false, skipped: true };
  const oldest = orders.reduce((a, b) => (new Date(a.manualReviewAt || a.createdAt) < new Date(b.manualReviewAt || b.createdAt) ? a : b));
  const key = crypto.createHash('sha256').update(orders.map((o) => o.reference).sort().join(',')).digest('hex').slice(0, 16);
  return sendBrevoSms({
    to: process.env.ADMIN_SMS_TO,
    sender: process.env.BREVO_SMS_SENDER || 'PjDigital',
    content: `PjDigital: ${orders.length} PAID order${orders.length === 1 ? '' : 's'} waiting for approval (oldest ${heldAge(oldest)}). Open the admin dashboard.`,
    idempotencyKey: `held-digest-sms/${key}`,
  });
}
