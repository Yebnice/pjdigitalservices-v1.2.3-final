# PjDigitalServices v1.3.9 — final build notes

This build starts from the "fixed" v1.3.9 zip (which already corrected 8
issues relative to "current") and adds the following on top, per review
against the Techlink Business API v1 Postman docs.

## Carried over from the "fixed" build (unchanged here)
1. `pages/api/admin/reconcile.js` — fixed a crash (undefined `actor` /
   `generateAiSummary`) that made every reconciliation run throw and 500.
2. `lib/rateLimit.js` + `pages/api/admin/login.js` — fixed IP-spoofing:
   rate limits and login throttling now key off `x-vercel-forwarded-for`
   or the last (trusted) hop of `X-Forwarded-For`, not the first hop a
   client controls.
3. `lib/payment.js` — payment-verification retries no longer burn all
   retries against a definitive declined/failed payment; the customer now
   sees an honest failure message instead of "check back later."
4. `lib/store.js` — a verified/paid order can no longer be downgraded back
   to `payment_pending` by a late/duplicate webhook.
5. `pages/api/admin/export-orders.js` — CSV/formula-injection fix: fields
   starting with `=`, `+`, `-`, `@`, tab, or CR are now neutralized before
   export.
6. `pages/api/jobs/fulfill.js` — the wallet-balance alert and the rest of
   the fulfillment run can no longer be skipped by an uncaught error in
   webhook-queue processing.
7. `lib/networkValidation.js` — added the `059` MTN prefix.
8. `pages/afa.js`, `pages/bills.js` (ECG/Water), `pages/tv.js`,
   `components/TierShop.js` (bulk-data fallback estimate) — price previews
   now include the business markup, not just the Paystack fee, via the new
   `previewCustomerTotal()` helper in `lib/pricing.js`.

## New in this build
9. **`pages/checker.js`** — the BECE/WASSCE voucher and paid-lookup price
   displays had the same bug as #8 but were missed by the "fixed" build:
   they showed the raw provider price with no markup and no Paystack fee
   at all. Now routed through `previewCustomerTotal()`, matching how
   `/api/orders/create.js` actually prices `orderType: "checker"` orders.
10. **`pages/bills.js` — Water lookup consistency.** ECG's "Look up" has
    always required both meter and phone before revealing the account
    holder's name (a deliberate fraud-prevention gate). Water's "Check
    bill" only required the meter/account number. Water now also requires
    a phone number before checking, for the same reason.
11. **`lib/techlink.js` — ECG lookup resilience.** Techlink's docs only
    document `GET /ecg/lookup` with `meter` alone, or `phone` alone as an
    *alternative* lookup mode ("pass phone instead to list meters on a
    number") — not both together. The app deliberately requires both from
    the customer (see #10), but the actual provider call now tries the
    combined query first and falls back to the documented meter-only call
    if that doesn't resolve, so an unexpectedly strict provider API can't
    block every ECG top-up. This has not been verified against a live
    Techlink sandbox — recommend testing with a real test key before
    relying on the fallback path in production.
12. **Test suite.**
    - Fixed a regression already present in the "fixed" build:
      `tests/deepAuditInvariants.test.js` still asserted the old MTN
      prefix list (without `059`), which would have failed CI against the
      "fixed" `lib/networkValidation.js`.
    - Added `tests/reconcileHandler.test.js` — actually invokes the
      reconcile handler (with mocked `adminAuth`/`store`/`auditLog`) to
      pin fix #1 and the status-matching logic in place, instead of only
      asserting on source text.
    - Added regression cases to `tests/rateLimit.test.js` for the
      IP-spoofing fix (#2), `tests/networkPrefixes.test.js` for the `059`
      prefix (#7), and `tests/pricing.test.js` for `previewCustomerTotal`
      correctness and its adoption across afa/bills/tv/checker/TierShop.
    - Updated `tests/billsWorkflow.test.js` for the Water phone
      requirement (#10) and the ECG lookup fallback (#11).

## Not changed / recommend follow-up
- I could not run `npm install && npm test` in this environment (no
  network access) — the new/updated tests were traced by hand against the
  handler logic but should be run for real before deploying.
- Item #11's fallback logic is defensive but unverified against Techlink's
  actual API behavior for a combined meter+phone query — worth a live
  sandbox check.
