# System assessment and integrated protection design (v1.4.3)

Scores are my professional judgement on a 0-10 scale, where 10 means "what I would be comfortable running for a
growing payments reseller with real customers". They are NOT measurements. Each score is tied to evidence in this
repository. "Before" is the code you uploaded; "Now" is v1.4.3 **assuming the deployment steps are done and the items
marked UNVERIFIED are confirmed**. Nothing here was run against your live Supabase, Paystack or Techlink.

## 1. Scorecard

| # | Structure | Before | Now | Evidence for "now" | What still caps it |
|---|-----------|:-----:|:---:|--------------------|--------------------|
| 1 | Payment verification (Paystack) | 4 | 8 | Success + live domain + same reference + exact amount + GHS before anything is accepted; test-mode refused in production (`paymentGuard`, 9 unit + 7 e2e tests). | Amount still set in the browser (server `initialize` not enabled); no automated refunds. |
| 2 | Spend authorisation (who/what may use wallet money) | 2 | 8 | Four independent locks: delivery mode, discovery age, payment record, last-mile re-check; sweeps and "Check outstanding orders" cannot deliver; spending needs the admin role by default (38 + 31 e2e). | No daily spend cap or second-person approval for large orders. |
| 3 | Provider integration (Techlink) | 5 | 7 | 9 request shapes proven against the Postman document by a fake that rejects deviations; test key and `testMode` responses refused; voucher completeness enforced. | No idempotency/client reference exists in Techlink's API (verified); response shapes for agent orders and status values are not documented; validation endpoints in the doc are inconsistent. |
| 4 | Customer experience and trust | 5 | 7 | One order number everywhere (screen, email, SMS); vouchers actually delivered; honest "held / queued / delivered" wording; masked phone; table history with receipts; test-mode and price-change explained. | No live order-status page, no PDF receipt, voucher PINs stored unencrypted. |
| 5 | Bookkeeping and reconciliation | 4 | 7 | Reconciliation compares whole pesewas (found a float bug that hid 4 of 8 one-pesewa errors); refunds/disputes recorded; daily close with totals; CSV exports; actual Paystack fee and net stored. | Revenue not netted for refunds; no Techlink wallet-balance reconciliation; books by creation date, not payment date. |
| 6 | Admin dashboard (controls, records) | 5 | 8 | All seven sections are tables with the same column discipline; receipt numbers (order no., Paystack reference, transaction ID, Techlink order ID) in every order view; audit log filter + export. | Audit/feedback lists not paginated; no per-action approval limits. |
| 7 | Application security | 7 | 8 | scrypt, hashed expiring tokens, timing-safe checks, CSRF origin check, CSV formula neutralisation, rate limits on every public route, secrets kept out of the AI prompt. | Rate limits are per-server without Redis (now warned); no Content-Security-Policy nonces. |
| 8 | Database security (Supabase) | 5 | 8 | RLS on 7 tables, no policies/views/functions, public-role grants revoked by migration; `security-audit.sql` to prove it. | **Not executed on a real database.** Live settings unseen. |
| 9 | Operability and resilience | 5 | 7 | Second trigger (Vercel cron), digest alerts instead of floods, deferral (not parking) on setting/key problems, red banners for test keys, heartbeat. | No external uptime monitor; backup restore never rehearsed; GitHub cron remains best-effort. |
| 10 | Verification maturity | 5 | 7 | 151 end-to-end checks + mutation checks showing each fix is caught; 34 render checks; undefined-name scan proven to work. | No real `next build`, browser/phone test, or real-Postgres run; 31 original unit tests not runnable in my stand-in runner. |

Overall: **about 4.7 before, about 7.5 now** (simple average). The remaining distance to 9 is the roadmap in section 4.

## 2. Integrated protection design (defence in depth)

One principle: **a customer's payment, the app's decision to spend, and the provider's answer are three different facts,
and each must be proven independently before the books and the customer are told "delivered".**

1. **Prove the money is real** (Paystack): live, this reference, this amount, GHS. Test-mode and wrong-reference payments are
   refused and audited. A late-discovered payment is recorded but not acted on.
2. **Decide who may spend** (policy engine in `deliveryPolicy.js`, enforced at intake and again right before the Techlink
   call): automatic mode + fresh live payment + payment record + recent verification, or a named admin. Everything else
   waits in *Paid - awaiting your approval*.
3. **Prove the provider really delivered** (Techlink): live key only; a `testMode` answer is not a delivery; a voucher
   purchase must return the vouchers; "queued" is reported as queued, never as delivered; ambiguous outcomes go to a human
   with Techlink's own history as evidence.
4. **Keep the evidence** (records): audit log of every decision and approval, order number + Paystack reference + transaction
   ID + Techlink order ID on every order, actual fee and net stored, daily close, pesewa-accurate reconciliation,
   refund/dispute trail, CSV exports.
5. **Keep the customer informed and safe**: one order number everywhere; vouchers delivered by the app; secrets
   (tokens, PINs) shown only to the verified owner and never sent to the AI provider; plain explanations for held, queued
   and rejected payments.
6. **Make failure visible and cheap**: red banners (test keys), amber banners (no Redis, refunds/disputes), health endpoint,
   one digest instead of an alert storm, a second trigger so a late GitHub cron does not strand orders.

## 3. Customer-service runbook (what to say and do)

| Customer says | Look at | Reply / action |
|---------------|---------|----------------|
| "I paid, nothing came" | Dashboard, Orders, search their order number or phone | *Paid - awaiting your approval*: check Paystack, press Approve & deliver, tell them it is being released. *Queued*: Techlink is still processing (the app tells customers "usually 30 min to a few hours"; that is the app's wording, not a Techlink guarantee); the app confirms it itself. *Delivery failed*: see Needs attention. |
| "Where is my voucher?" | Order receipt (My Orders, Receipt) | The serial and PIN are on the receipt and were emailed (or texted) to them. If the order is held with "voucher", get the PIN from Techlink (Result Checker, My Checkers) and send it. |
| "I was charged twice" | Reconciliation, Paystack | Two different references = two payments. Same order twice is blocked by the delivery claim. Refund the extra in Paystack; the refund event appears in the Audit tab. |
| "Wrong number" | Order details (Recipient) | The app cannot recall a delivery. Check Techlink's cancel window for non-airtime products; otherwise log it. |
| "My payment failed but I was debited" | Needs attention, Customer charged, nothing delivered | Inspect what Paystack took; accept and send, or refund. |

## 4. Roadmap from 7.5 to 9 (ordered by risk reduced per effort)

1. **Run the migrations on a scratch project, then production** (PDF steps 3.4 to 3.6), and run `npm test`, `npm run test:e2e`, `npm run build`. *(Closes the biggest unverified gap.)*
2. **Server-side Paystack `initialize` + `resumeTransaction`**: removes browser-set amounts.
3. **Ask Techlink for a client reference or use `callbackUrl`**: today a timeout leaves "did it deliver?" to a human.
4. **Daily wallet-spend cap**: above a limit, even automatic delivery waits for an admin.
5. **Techlink wallet-balance reconciliation**: expected balance from orders vs `GET /wallet/balance` each day.
6. **Encrypt voucher PINs at rest** with the existing AFA key mechanism.
7. **Redis for rate limits; an external uptime monitor on `/api/admin/health`**.
8. **Decide the airtime price** (open decision 1).
