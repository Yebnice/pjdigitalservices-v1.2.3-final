# v1.4.4: paid customers delivered at once, stale/unpaid payments only ever reach YOU

## What changed
1. **Instant settle.** The Paystack webhook now stores the notification (as before), then immediately verifies it with Paystack and delivers it if it passes every check. A customer who pays and closes the page no longer waits for a background run. If anything fails, Paystack still gets its 200 and the worker retries. Switch off with `WEBHOOK_INLINE_SETTLE=false`. `vercel.json` gives the webhook a 60 s limit.
2. **Stale notifications are never delivered by a background run.** A notification that waited longer than `PAYSTACK_WEBHOOK_AUTO_MAX_MINUTES` (default 30) is still checked with Paystack and recorded, but the order is held in Needs attention. Only your Approve & deliver sends it.
3. **Paystack notifications table** (new tab, read-only): every notification not fully settled, with order, status, wait time, retries and last error. CSV export. Banner wording corrected: it no longer says to run the worker.
4. **Evidence trail.** `paystack_payment_confirmed` (Paystack's status, live/test domain, transaction id, amount, paid_at) is written before any decision, and `sent_to_techlink` (automatic or approved by whom, payment record) is written before every Techlink call. Search the audit log by order reference to see exactly why an order was sent.
5. `markPaymentVerified` now only accepts orders that are unpaid or already verified.
6. `supabase/migration_v1_4_4.sql` (optional, untested against a live database): the database itself refuses to start a delivery for an order with no recorded payment. Try on a Supabase branch first.

## Unchanged (already correct in v1.4.3, covered by tests)
Only Paystack-confirmed LIVE money with the exact amount and matching reference is delivered automatically; test-mode payments, abandoned/failed/unknown payments, wrong amounts, old checkouts, manual mode, and anything found by "Check outstanding orders" never deliver without an admin.

## Tests
`node --import ./tests/e2e/loader/register.mjs tests/e2e/webhook-settle.e2e.mjs` (13 checks, included in `npm run test:e2e`). The stale-notification and finished-order checks were verified to fail when their guard is removed.

## Worker not reporting
The dashboard says the background worker has never reported. Check: GitHub Actions tab (scheduled workflows are switched off after 60 days without repository activity), the `CRON_SECRET` GitHub secret equals the Vercel `CRON_SECRET` value, the URL in `.github/workflows/background-worker.yml` is your live domain, and `app_settings` exists (earlier migrations).
