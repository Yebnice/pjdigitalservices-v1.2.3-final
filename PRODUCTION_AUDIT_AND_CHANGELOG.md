# PjDigitalServices — Production Audit & Hardening Changelog

## v1.3.9 final production fact-check — September 25, 2026

- Corrected an admin reconciliation privacy mismatch: optional Gemini summaries now receive only aggregate reconciliation counts and an instruction to explain those totals; transaction references and per-transaction details are not sent to Gemini.
- Corrected a role dead end in the admin dashboard: viewer accounts no longer call the operator-only Techlink wallet endpoint and therefore do not receive a misleading wallet-access error.
- Added CI secret-leakage scanning with safe handling for documented placeholders and test fixtures.
- Added regression coverage for admin RBAC, distributed login throttling, reconciliation redaction, and viewer wallet behavior.
- Bumped the application release version to v1.3.9.
- Final verification on the fact-check branch: 11 test files, all regression tests passed; rate-limit and production-contract checks passed; secret scan passed; Next.js production build passed.

## v1.3.6 full workflow/document audit — September 24, 2026

- Audited the payment -> order -> Techlink fulfillment -> background-worker path against the supplied Techlink Business API V1 document.
- Found and fixed a real Paystack webhook retry runtime bug: an undefined `terminal` variable could crash webhook job requeueing.
- Found and fixed a real pricing-policy bug: `tierBulkAirtime` was not normalized before the zero-margin lookup, so it could receive the default 1% business margin.
- Found and fixed a customer-facing pricing mismatch for Agent Data Products: the live tier catalogue endpoint was returning raw Techlink prices while order creation applied the customer pricing policy and Paystack fee. The endpoint now returns only customer-facing product/checkout prices, and the tier UI uses those values where available.
- Removed the unused public `/api/techlink/airtime-fee` proxy so Techlink's internal provider fee is not unnecessarily exposed to customers.
- Tightened idempotency-key reuse so a reused key must match the original checkout email before an existing order is returned.
- Updated release documentation/schema versioning to v1.3.6.

## v1.3.7 ECG/Water bill workflow audit — September 25, 2026

- Aligned ECG validation with the Techlink document's meter lookup and documented phone-based alternate lookup.
- ECG lookup errors are now distinguished between an actual not-found response and temporary provider availability problems.
- Water validation now passes the customer's phone and can use the documented GWCL account+phone validator before payment when the primary Water validator does not resolve a payable amount.
- Bill payment cannot remain enabled after the customer changes the meter/account or phone until the new details are validated again.
- Customer-facing billing errors no longer incorrectly label provider outages as missing meters/accounts.

## v1.3.8 deep source/document verification — September 25, 2026

- Performed a source-wide secret-leakage scan over the verified source package. No real Paystack, Techlink, Supabase, Gemini/OpenAI, GitHub, AWS, Slack, private-key, cron, or AFA encryption secret values were found. `.env.example` contains placeholders only.
- Reconciled all Techlink Business API V1 calls against the supplied Postman/API document, including Airtime, Data Bundles, ECG, Water, TV, Result Checker, Result Checking Service, Agent Data Products, AFA, Orders, Verify, Wallet Balance and Airtime Fee.
- Confirmed provider-cost and internal business-markup fields remain server-side and are not included in public order responses.
- Corrected stale/duplicated AirtelTigo prefix guidance so one shared network-validation source is used. Prefix checks remain safety hints rather than provider-of-record truth.
- Corrected ECG lookup so an HTTP-success response that does not actually resolve an account cannot enable payment.
- Corrected Quick Data network-confirmation state so changing the phone or selected network clears the previous confirmation.
- Reconciled current Gemini runtime documentation with Google's current Gemini 3.8 Flash model and medium thinking configuration.
## What was reviewed

The project was reviewed layer-by-layer across the Next.js application, API routes, Paystack flow, Techlink integration, Supabase storage, customer order tracking, admin area, PWA files and customer-support chatbot.

Current external facts were checked against official documentation for Next.js, Paystack, Supabase and Google Gemini.

## Major fixes applied

### 1. Framework/security baseline
- Current release is pinned to Next.js 16.3.x (declared floor `^16.3.6`) and React 19.2.
- Added Node.js >=20.9 engine requirement.
- This matches the current Next.js support guidance: 16.x is Active LTS; 14.x is unsupported.

### 2. Admin authentication
- Removed browser localStorage storage of the admin password.
- Removed the `x-admin-key` authentication pattern.
- Added an HttpOnly, signed, expiring admin session cookie.
- Added login throttling.
- Added `/api/admin/login`, `/api/admin/logout`, and `/api/admin/me`.
- Missing `ADMIN_SESSION_SECRET` now fails closed instead of making the admin page public.

### 3. Customer order privacy
- Removed broad public searches by phone/email.
- Customer tracking now requires the exact order reference plus checkout email.
- Public tracking responses contain only customer-safe order fields.
- The admin endpoint remains able to retrieve full records after authentication.

### 4. Payment/fulfillment hardening
- Added a payment/fulfillment state machine:
  `pending -> payment_verified/ready -> processing -> fulfilled`
  with retryable `failed` fulfillment state.
- Added an atomic fulfillment claim so browser verification and Paystack webhook processing cannot both submit the same order to Techlink.
- Added payment amount and currency verification.
- Added a scheduled fulfillment worker endpoint at `/api/jobs/fulfill`.
- Failed fulfillment is retryable up to `MAX_FULFILLMENT_ATTEMPTS`.

### 5. Paystack webhook behavior
- Webhook signature validation is timing-safe.
- Webhook verifies the payment before marking the order ready.
- Webhook acknowledges quickly instead of performing long-running Techlink fulfillment inside the webhook request.

### 6. API abuse controls
- Added basic rate limiting for order creation, order tracking, feedback and AI chat.
- This is intentionally a lightweight application-level safety net; distributed deployments should also use the hosting platform's WAF/rate-limiter or a shared limiter.

### 7. AI customer support
- Reworked the chatbot into a hybrid assistant.
- No AI key: built-in FAQ mode still works.
- With `GEMINI_API_KEY`: the server uses the Gemini API with `GEMINI_MODEL` (default `gemini-3.8-flash`, Google's GA Flash-tier model released September 2, 2026). Support-chat replies use Gemini's `medium` thinking level by default, which matches Google's current Gemini 3.8 Flash default/recommended setting for quality-focused tasks.
- Added secure order lookup inside chat only when both order reference and checkout email are supplied.
- The AI is prohibited from charging customers, bypassing Paystack, inventing live prices/statuses, or requesting/repeating PINs and sensitive identity information.
- Added a secure “Track my order” flow inside the chat widget.

## Required database migration

Run the updated `supabase/schema.sql` against the existing database. The important new order columns are:

- `fulfillment_status`
- `fulfillment_attempts`
- `last_fulfillment_error`
- `payment_verified_at`
- `payment_amount`

The schema file includes an idempotent migration block for existing deployments.

## Required environment values

Set these in deployment secrets:

- `PAYSTACK_SECRET_KEY`
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `TECHLINK_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or migrate to Supabase's newer `sb_secret_...` key)
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- Optional: `GEMINI_API_KEY`
- Optional: `GEMINI_MODEL`

## Scheduler requirement

The fulfillment worker must be called regularly in production:

`POST /api/jobs/fulfill`

with:

`Authorization: Bearer <CRON_SECRET>`

A hosting cron, external scheduler or equivalent should run this frequently enough for your service-level expectations.

## What was not falsely certified

I did not claim a live Paystack/Techlink transaction passed because no production credentials were supplied. The Techlink client was audited against the documentation already bundled/referenced by the project, but private endpoint behavior still needs a real test-key transaction before go-live.

## Build verification note

Node syntax checks passed for the modified server-side JavaScript and the modified JSX files were parsed successfully with TypeScript's JSX parser. A full `npm install`/`next build` could not be completed in this environment because dependency installation timed out on package-network access; run `npm install` followed by `npm run build` in your normal development environment before deployment.

## v1.1.1 hardening pass

- Added `processing_started_at` to support stale-worker detection.
- Stale fulfillment claims are moved to `manual_review`, not automatically retried, because Techlink idempotency has not been independently confirmed.
- Added rate limiting to public payment verification.
- Paystack webhook now returns HTTP 500 on internal processing errors so Paystack can retry instead of receiving a misleading success acknowledgement.
- Added explicit stale-fulfillment recovery processing to the scheduled worker.

### Remaining production gate
Before enabling automatic retries after a stale provider call, confirm Techlink supports idempotent transaction/reference submission or exposes a safe transaction-status lookup.

## v1.2.0 support/notification hardening
- Preserved official SLA wording in the FAQ.
- Updated FAQ failure wording so it no longer promises blind automatic retries.
- Added stale-order admin email notifications (optional via Resend).
- Added neutral customer delay notification: order is still processing; apologize for delay; do not mention payment review.
- Added notification deduplication timestamps to prevent repeat alerts.
- Added Admin > Manual Review view.
- Added `/api/orders/manual-review` admin endpoint.
- Added environment configuration for notification email delivery.

### v1.2.0 operational notes
- Run `supabase/migration_v1_2.sql` on an existing database before deploying this version.
- Configure `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, and `ADMIN_ALERT_EMAIL` to enable automatic stale-order email alerts.
- Customer delay email deliberately says the order is still processing and apologizes for the delay; it does not say that payment is under review.
- Official service SLA wording in `pages/faq.js` has been preserved.


## v1.2.1 approved hardening additions
- Added admin-authorized manual-review actions: confirm fulfilled or authorize retry, each requiring an audit note.
- Added optional Twilio WhatsApp/SMS urgent escalation for manual-review orders.
- Fixed notification state so a notification is only recorded as sent after the provider reports success.
- Added Resend per-event idempotency keys instead of one global key.
- Preserved official provider SLA wording; customer delay messages say the order is still processing and apologize for the delay.


## v1.2.1 — final hardening review — September 15, 2026
- Added admin-authorized manual-review resolution/retry actions with mandatory notes.
- Added optional Twilio WhatsApp/SMS escalation; WhatsApp requires a configured approved content template.
- Added support-case lookup by case reference plus the contact detail used when submitting the case.
- Added throttling to public provider lookup endpoints and customer registration.
- Sanitized public order result/error fields.
- Fixed notification state so failed email delivery can be retried; Resend uses a unique per-event idempotency key.
- Stale processing recovery now always moves eligible stale claims to manual review, including orders at the maximum attempt count.
- Preserved the official SLA wording supplied with the project; only fulfillment/retry language was corrected.


Release: v1.2.1. Full npm install/build remains a deployment-environment verification step because package installation timed out in the audit container.


## v1.2.2 — Support transaction evidence requirements
- Data and airtime complaints now require Transaction ID, Amount, Data/Airtime Requested, Recipient/Beneficiary, Transaction Date & Time, Transaction Details, and complaint description.
- Other product complaints use the standard support form with transaction details relevant to the service.
- Email or phone is required so support can follow up and customers can track their case.
- The chatbot includes a structured complaint form and submits to the same server-side validation as the Feedback page.
- Admin feedback view displays service, transaction ID, amount, requested data, beneficiary, transaction time and transaction details.
- Added v1.2.2 Supabase migration: `supabase/migration_v1_2_2.sql`.


## v1.2.3 — Escalation provider swap (Twilio → Brevo)
- Replaced the Twilio WhatsApp/SMS urgent-escalation integration with Brevo transactional SMS. Brevo has no direct WhatsApp-template equivalent, so the WhatsApp leg is dropped; the admin-alert **email** channel (via the existing Resend integration) is now the second, independent escalation channel in its place.
- New env vars: `BREVO_API_KEY`, `BREVO_SMS_SENDER` (optional, defaults to `PjDigital`). Removed: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_CONTENT_SID`, `ADMIN_WHATSAPP_TO`. `ADMIN_SMS_TO` is unchanged.
- Fixed a pre-existing bug in `recoverAndListReadyOrders`: the two escalation channels were tried inside one `try/catch`, so if the first channel's send call threw, the second channel was silently never attempted for that cycle. Each channel now has its own `try/catch`, so a failure on one never blocks the other.
- No schema changes required for this release.


## v1.2.4 — Pre-launch fixes (dependency, authz, and a broken endpoint)
- **`xlsx` dependency**: the npm registry only ever published up to `0.18.5`, which carries two unpatched high-severity CVEs (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS) — and this app parses customer-uploaded Excel files client-side (`components/TierShop.js`, embedded in the public `/mtn-data`, `/at-data`, `/telecel-data` pages), so this was public attack surface. Switched `package.json` to install the fixed `0.20.3` build directly from SheetJS's own CDN distribution (`https://cdn.sheetjs.com/`), which is the vendor's documented distribution channel since they stopped publishing to npm.
- **`next` dependency**: `^16.3.3` was never a published version — `npm install` would have failed outright. Repinned to `^16.2.10`, a real, current release (16.2.5 was itself a security release).
- **`POST /api/customers/register` was completely broken**: it called `rateLimit(...)` without ever importing it, so every request threw an unhandled `ReferenceError` before reaching the try/catch. The "create an account" autofill feature has never worked. Added the missing import.
- **Order/case tracking authorization bypass**: `.ilike("email", ...)` in `findCustomerOrder` (store.js) and `findCustomerCase` (feedback.js) let a SQL wildcard in the submitted email (e.g. `%@%`, or a bare `%`) match any record regardless of its real email, given a known/guessed reference. Switched both to exact `.eq()`. Also switched support-case reference generation from `Math.random()` to `crypto.randomBytes`.
- Added baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`) to `next.config.js`, which previously set none.
- Fixed a case-sensitivity bug in the result-checker "lookup" fulfillment path (`lib/techlink.js`): sent uppercase `BECE`/`WASSCE` to `/result-check-service/request`, which the API's own docs example shows as lowercase — paid lookup orders could fail fulfillment over letter case.
- Replaced the Twilio WhatsApp/SMS escalation with Brevo transactional SMS + the existing Resend email as the second channel (see `.env.example` and DEPLOYMENT.md section 3).
- Chat widget and AI system prompt now consistently introduce the assistant as "Annette."


## v1.2.5 — Paystack fee pass-through, Techlink docs fact-check, admin Overview tab
- **Paystack fee pass-through (1.95%)**: `lib/pricing.js` had a `withPaystackFee()` helper that was already written but never called anywhere — customers were charged the raw product price and the business absorbed Paystack's cut out of margin on every order. Wired it into checkout end-to-end: `pages/api/orders/create.js` now computes and stores a fee-inclusive `checkoutAmount` alongside the original `amount` (which stays the authoritative product cost — unchanged, and still what's sent to Techlink for fulfillment, so no product is ever over-delivered). Payment verification (`lib/orderProcessing.js`) now checks Paystack's transaction against `checkoutAmount`. New nullable columns `checkout_amount`, `paystack_fee_amount` on `orders` (see `migration_v1_2_5.sql`); `amount` is untouched.
- **Caught before shipping**: `pages/api/admin/reconcile.js` compares stored orders against Paystack's CSV export by amount — it was matching against the base `amount`, which would have flagged every single order as a mismatch the moment the fee went live. Fixed to compare against `checkoutAmount`.
- All customer-facing "Pay GHS X" checkout buttons (airtime, data, bills, TV, AFA, TierShop bulk/Excel) now show the fee-inclusive total that will actually be charged, instead of the bare product price. `OrderReceipt` now shows a transparent Product price / Processing fee / Total paid breakdown instead of only ever showing the product price.
- Admin dashboard: added "Paystack fees recovered" as its own stat, kept "Total sales" as net product revenue (not inflated by the fee pass-through). CSV export now has separate Product/Fee/Total columns.
- **Techlink API fact-check** against the vendor's own Postman documentation: cross-checked every endpoint, method, body field, and response shape currently integrated in `lib/techlink.js` against the docs. No incorrect endpoint calls or field-name bugs found — the water/TV bill-lookup response field fallbacks (`balance ?? amountDue ?? amount`, `customerName`/`packageName ?? package`) already defensively cover the field-name ambiguity the docs themselves show. One real gap found and fixed (below).
- **New: Techlink wallet balance monitoring.** Every order fulfilled by this app debits the business's own Techlink wallet (`paymentMethod: "wallet"`), but nothing in the app ever checked that balance — Paystack still charges the customer even if the wallet is empty, so a dry wallet meant orders would start failing at fulfillment, silently, after the customer had already paid. Added `getWalletBalance()` (`lib/techlink.js`, `GET /wallet/balance`), an admin-only endpoint (`pages/api/admin/wallet-balance.js`), and a live low-balance warning banner + stat card on the admin dashboard (polls every 2 minutes; threshold is a constant in `pages/admin/index.js`, adjust to your typical order size).
- **New: admin dashboard Overview tab** — set as the default tab. Date-range filter (Today / 7 days / 30 days / All time), headline stats (revenue, orders, success rate, avg order value, fees recovered), a daily revenue trend bar chart, and a top-5-products-by-revenue breakdown. Hand-rolled (no charting library in `package.json`); pure SVG.


## v1.2.6 — Silent-failure escalation gap
- **Real bug found and fixed**: orders that fail outright (Techlink call throws — insufficient wallet balance, bad meter/account, a provider error) are correctly retried automatically by the fulfillment worker up to `MAX_FULFILLMENT_ATTEMPTS`. But once an order exhausted those attempts, it just sat at `fulfillment_status: "failed"` forever — excluded from further automatic retry, and invisible to the admin email/SMS escalation pipeline, which only ever looked at orders recovered from a stale "processing" state. It was still listed in the admin "Needs Attention" tab, but nobody was ever paged about it — a run of failures sharing one root cause (e.g. the Techlink wallet running dry, so every order after that point fails the same way) would have produced zero alerts, discoverable only by an admin happening to open the dashboard.
- Fixed with `promoteExhaustedFailedOrders()` (`lib/store.js`): once a "failed" order exhausts its automatic retries, it's promoted into the same `manual_review` state used by the existing stale-processing recovery path, which routes it through the already-working admin notification and urgent-escalation logic (`recoverAndListReadyOrders`, `lib/orderProcessing.js`) — no new, separate notification path to maintain.
- Cleaned up two other comments left over from earlier reviews that incorrectly claimed this project "has no cron running the promotion job" — it does (`/api/jobs/fulfill`, documented in `DEPLOYMENT.md`); the actual gap was narrower than that (see above).




## v1.2.6 production hardening (rebuilt)

- Automated `queued_with_provider` checks in the fulfillment worker; customer/admin page views remain a backstop.
- Added Vercel Cron configuration at `/api/jobs/fulfill` (5-minute schedule). No Cloudflare dependency. Verify the deployment plan permits the configured cron frequency.
- Added database-backed unique idempotency key on orders and client/server retry using the same key.
- Added configurable business markup engine separate from provider cost and Paystack fee; airtime provider fees are included in provider-cost estimation before margin is calculated.
- Added server-enforced bulk row, per-line airtime, bulk-total, and single-order product-value limits.
- Added `.gitignore` and bumped package metadata to v1.2.6.
- Added customer-facing chatbot response metadata (`source: gemini|faq`) so a successful FAQ fallback is not mistaken for a successful Gemini call.
- Defaulted Gemini to `gemini-2.5-flash` rather than the previously documented unverified newer model name. Live availability still requires a real API-key test.


## Pricing update

- Default PjDigitalServices business margin is now **1%** of provider cost.
- Paystack fee remains **1.95%** of the gross checkout transaction and is grossed up so the business still receives the provider-cost-plus-margin amount after the Paystack fee.
- Service/network-specific margins remain configurable through `SERVICE_MARKUP_RULES_JSON`.
- No Cloudflare dependency is introduced.


## v1.2.6 follow-up correction — service pricing and support grounding
- Plain Airtime and Quick Data Top-up (`orderType: airtime` and `orderType: data`) now have an explicit 0% business margin. They still include the configured 1.95% Paystack fee.
- Bulk Airtime is also treated as 0% business margin so an Airtime product does not receive the 1% margin unintentionally.
- Tiered data products continue to use the 1% default business margin unless an explicit service rule overrides it.
- The customer-support FAQ and Gemini grounding now describe Airtime and Quick Data Top-up as instant after payment confirmation, while retaining MTN Master as non-instant.
- The chatbot language was rewritten to be warmer, more professional, action-oriented, and grounded in verified store facts; it explicitly avoids inventing prices, statuses, delivery guarantees, or provider outcomes. The widget identifies Annette as AI-assisted support, while the backend retains a deterministic FAQ fallback.


## v1.2.7 — Two more real bugs found and fixed, plus a manual-resolution gap closed

- **Real bug: bulk/Excel MTN Master orders were falsely marked "Delivered."** The v1.2.6 fix for the non-instant-tier queuing bug (see the v1.2.6 entry above) only checked `orderType === "tierData"` — a single order. But `components/TierShop.js` lets a customer run MTN Master through Bulk or Excel mode too (`orderType: "tierBulkData"`), and that path was never covered: it skipped the queued state and went straight to `fulfilled`, sending the customer a "Delivered!" email/SMS for an order Techlink's own docs describe as queued and non-instant. Fixed in `lib/orderProcessing.js` (`fulfillClaimedOrder`) by checking both order types against `TIERS[tierKey].instant`.
- **Consequence of the above, also fixed**: Techlink's bulk order endpoint (`POST /orders/bulk`) returns no response body per its own docs, so a queued bulk order has no `orderId` to auto-verify against — `checkQueuedOrder` will correctly leave it queued forever rather than guessing. Since `manuallyResolveOrder` previously only accepted orders in `manual_review`/`failed`, this meant a queued bulk order had no resolution path at all once an admin actually confirmed delivery with Techlink directly. Added `queued_with_provider` as an eligible source state for the `confirm_fulfilled` action only (`lib/store.js`) — deliberately **not** for `retry`, since retrying would resubmit an already-accepted bulk batch and risk double delivery. Wired a "Mark fulfilled manually" button into the existing "Queued with provider" admin panel (`pages/admin/index.js`), next to the existing "Re-check with Techlink" button.
- **Real bug: `FULFILLMENT_BATCH_SIZE` was silently ignored.** `pages/api/jobs/fulfill.js` passed `batchSize` into `recoverAndListReadyOrders(batchSize)`, but that function took no parameters — the argument was dropped, and every call fell through to the hardcoded default `limit = 20` in `recoverStaleProcessingOrders()`, `promoteExhaustedFailedOrders()`, and `listReadyOrders()` (`lib/store.js`). A deployment that raised `FULFILLMENT_BATCH_SIZE` above 20 for a busier store was still capped at 20 ready/stale/exhausted orders per worker run. Fixed by threading `limit` through `recoverAndListReadyOrders(limit)` to all three calls.
- Repinned `next` to `^16.2.11` in `package.json` — `16.2.10` (the previous floor) predates the July 20, 2026 Active-LTS security release that patched 4 HIGH and 5 MEDIUM severity vulnerabilities in the 16.2.x line. No lockfile is committed, so a fresh `npm install` was already pulling the patched version regardless; this just keeps the declared floor from claiming an unpatched minimum.

### Still worth doing (not app bugs, but real gaps)
- The in-memory `rateLimit()` (`lib/rateLimit.js`) doesn't share state across serverless instances on Vercel — each cold start resets its counters, so it under-enforces there. It's honestly commented as a "lightweight application-level safety net" already; for a production deployment on Vercel, pair it with the platform's own rate limiting or a shared store (e.g. Upstash Redis).
- The `Content-Security-Policy` header in `next.config.js` currently ships as `Content-Security-Policy-Report-Only` — intentional per its own comment (browse with dev tools open first, then rename it once you see zero violations), but it means nothing is actually enforced by CSP yet. Don't forget the rename before calling the site launched.
- The AFA registration field names (`name`/`idNumber`/`dateOfBirth` vs. the docs' own prose which says `fullName`/`ghanaCard`/`dob`) and the exact response shape of `/result-check-service/request` are the two remaining items that can only be confirmed with a real Techlink test-key transaction — no further static review can settle these.


## v1.2.8 — Deployment-readiness pass: full syntax/import/schema verification + one more real bug

This pass went beyond manual code reading: every `.js` file in `pages/`, `components/`, and `lib/` (87 files) was actually parsed with the TypeScript compiler's own parser (JSX-aware), every `import` was resolved to a real file and checked against that file's real exports, every `process.env.*` reference was cross-checked against `.env.example`, and every Supabase `.insert()`/`.update()`/`.eq()` field used in `lib/store.js`, `lib/customers.js`, `lib/feedback.js`, `lib/auditLog.js`, and `lib/reviews.js` was cross-checked against the columns actually created in `supabase/schema.sql`.

**Results:**
- 0 syntax errors across all 87 files.
- 0 broken imports, 0 imports of a name that isn't actually exported (the same bug class as the pre-v1.2.4 `rateLimit` import bug — confirmed nowhere else in the codebase).
- 0 environment-variable name drift between code and `.env.example` (the only code-side reference not in `.env.example` is `NODE_ENV`, which Next.js sets automatically and isn't something you configure).
- 0 database column mismatches — every field the code reads or writes on `orders`, `customers`, `feedback`, `audit_log`, and `reviews` exists in `supabase/schema.sql`.

**One more real bug found and fixed**: `OrderReceipt` (`components/ui.js`) — the confirmation screen shown immediately after a successful checkout — showed the same "Thank you! Your order has been processed." message with a green checkmark for *every* successful payment, including a queued, non-instant order (MTN Master, reachable via Single/Bulk/Excel on `/mtn-data`). This is the same false-delivery-confidence problem that `lib/orderProcessing.js` was fixed to stop emailing/texting about in v1.2.6/v1.2.7 — but this particular screen, the very first thing a customer sees, was never covered by that fix. `OrderList` (same file) already correctly branched on `fulfillmentStatus === "queued_with_provider"` for the order-history view; `OrderReceipt` now does the same — an amber clock icon, "Order received!" instead of "Thank you!", and copy matching the wording already used in `notifyCustomerOrderQueued` (`lib/notifications.js`), so the receipt and the follow-up email never contradict each other.

### Verification method note
No `npm install`/`next build` was run (no network access in this environment, same limitation noted in every earlier release). What changed this pass is that the syntax/import/schema checks above are no longer "read the code carefully" — they're mechanical, using the TypeScript compiler API and a real schema diff, which catches classes of error (typo'd imports, drifted env var names, missing DB columns) that manual review can miss. This narrows, but does not eliminate, the need for one real `npm install && next build` plus a live Techlink/Paystack test-key run before go-live.


## v1.2.9 — The two bugs from live testing, both confirmed and fixed. No Supabase changes needed.

Two real production incidents were reported from live testing:
1. A customer saw "Thank you, order delivered" immediately, but the data bundle actually took ~1 hour to arrive.
2. A customer was charged by Paystack, but their airtime never arrived, because the Techlink *business* wallet (yours, not the customer's) had insufficient balance to fulfill it.

**Incident 1 is the same bug already fixed in v1.2.8** (`OrderReceipt` unconditionally showing "Thank you!"/processed for queued MTN Master orders) — that fix was already in the v1.2.8 package. If this was seen on a live deployment, it means the live GitHub copy predates v1.2.8; this package includes that fix.

**Incident 2 was a separate, previously-unfixed bug**, now fixed here:

- **Root cause**: `lib/payment.js`'s Paystack callback only called `onDone()` (show the receipt) when `result.status === "success"`. Every other outcome — including a payment that succeeded but where the immediate Techlink fulfillment call failed (insufficient wallet balance, bad meter number, provider timeout, etc.) — fell into `onError()`, which showed a bare red toast like *"Payment processing."* with **no order reference and no acknowledgment that the charge had gone through.** The backend retry logic itself (`lib/store.js`: automatic retry up to `MAX_FULFILLMENT_ATTEMPTS`, then promotion to `manual_review` with an admin alert) was already correct and unaffected — the money wasn't lost and the order genuinely was queued for another attempt. But the customer, staring at what looked like a plain error, had no way to know that, and no reference number to ask support about.
- **Fix, `lib/payment.js`**: route to `onDone()` whenever the API response includes an `order` object at all (which only happens once Paystack has actually confirmed the charge), rather than gating on the exact status string. A genuine payment failure (declined card, amount/currency mismatch) still has no `order` in the response and still correctly shows an error.
- **Fix, `components/ui.js` (`OrderReceipt`)**: added a third bucket alongside "fulfilled" (green check) and "queued_with_provider" (v1.2.8's amber clock) — anything else (`processing`, `failed`, `manual_review`, `ready`) now shows "Payment received!" with an honest "we're completing your order now, you don't need to pay again, contact support with this reference if it doesn't arrive" message. The order reference itself was already always shown in the receipt row, so it's now paired with copy that actually tells the customer what's going on.
- **Supabase / schema**: **no changes needed.** This was purely a frontend response-routing and copy bug — no new columns, no new tables, nothing to run in the SQL editor for this fix.

### Recommendation (not a bug, optional follow-up)
There's currently no *proactive* alert when the Techlink wallet balance gets low — the admin only finds out reactively, once orders start failing and (after retries exhaust) a manual-review email goes out. `GET /wallet/balance` is already wired up (`lib/techlink.js`, used by the admin dashboard's balance display) and `/api/jobs/fulfill` already runs every 5 minutes — a low-balance check piggybacked onto that same cron run, alerting once balance drops under a configurable threshold, would catch this class of incident before a single customer is affected rather than after. Happy to build this if you want it — it would need one new small Supabase table (or a couple of env vars) to avoid re-alerting every 5 minutes while the balance stays low.

### Full re-verification after this fix
All 87 `.js` files across `pages/`, `components/`, `lib/` re-parsed with the TypeScript compiler (0 errors) and all imports re-resolved against real exports (0 problems) after these changes, same method as the v1.2.8 pass.


## v1.3.0 — Proactive Techlink low-balance alert, and clearer non-delivered wording

### ⚠️ Supabase change required for this release
Run this once, in the Supabase SQL editor, before deploying v1.3.0 (also included in `supabase/migration_v1_3_0.sql`, and folded into `supabase/schema.sql` for fresh projects):

```sql
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
```

This is a small, generic key/value table — no data migration, no changes to any existing table, nothing else needed.

### 1. Proactive Techlink wallet balance alert
The v1.2.9 fix made sure a customer is never misled when a low Techlink wallet balance causes a fulfillment failure — but the admin still only found out *after* that happened (reactively, once an order exhausted its retries and got promoted to `manual_review`). This adds the proactive half: `checkTechlinkWalletBalance()` (`lib/orderProcessing.js`) now runs on every `/api/jobs/fulfill` invocation (piggybacking on the existing 5-minute cron — no second scheduled job added) and emails + SMS's the admin (`notifyAdminLowBalance`, `lib/notifications.js`, reusing the existing `ADMIN_ALERT_EMAIL`/`ADMIN_SMS_TO` config) as soon as the balance drops under `TECHLINK_LOW_BALANCE_THRESHOLD` (default GHS 200).

- The new `app_settings` table (above) exists specifically to remember *when* the alert was last sent, so the 5-minute cron doesn't re-alert every single run while the balance stays low — `TECHLINK_LOW_BALANCE_ALERT_COOLDOWN_HOURS` (default 6) controls that window, and the marker is automatically cleared once the balance recovers above threshold, so the *next* dip alerts immediately rather than possibly being suppressed by a stale cooldown.
- The admin dashboard's existing low-balance banner (`pages/admin/index.js`) had its threshold hardcoded to `200` separately — it now reads `NEXT_PUBLIC_TECHLINK_LOW_BALANCE_THRESHOLD` (same default), so the on-screen banner and the proactive alert agree and only need to be changed in one place (two env var entries, same number).
- Both new checks fail closed and silent: a Techlink/Resend/Brevo/Supabase hiccup while checking or sending never fails the fulfillment run itself — it's logged and the run continues.
- New env vars (all with working defaults — nothing is required to keep the app running as before): `TECHLINK_LOW_BALANCE_THRESHOLD`, `NEXT_PUBLIC_TECHLINK_LOW_BALANCE_THRESHOLD`, `TECHLINK_LOW_BALANCE_ALERT_COOLDOWN_HOURS`.

### 2. Clearer non-delivered wording on the post-checkout receipt
Per direct feedback: v1.2.9's "Payment received!"/"Order received!" headings for a queued or still-processing order were an improvement over the old unconditional "Thank you!", but still read as ambiguous — close enough to "done" that a customer skimming it could still walk away thinking their order was delivered. `OrderReceipt` (`components/ui.js`) now uses one unambiguous heading for every non-delivered state — **"Order received — being processed"** — paired with copy that explicitly opens with "Your payment was successful" before explaining it isn't delivered yet. "Thank you!" is now reserved exclusively for `fulfillmentStatus === "fulfilled"` — a genuinely completed, confirmed delivery.

### Verification
All 88 files (87 + the new `lib/appSettings.js`) re-parsed with the TypeScript compiler (0 syntax errors), all imports re-resolved against real exports (0 problems), and every `process.env.*` reference cross-checked against `.env.example` (0 drift, same as every prior pass).


## v1.3.1 — Safer fulfillment: no blind retries, honest bulk handling, working escalation

### ⚠️ Supabase change required for this release
Paste **`supabase/schema.sql`** into Supabase → SQL Editor → Run. It is idempotent (fresh project or upgrade; never touches data). Minimum for an existing v1.3.0 database: `supabase/migration_v1_3_1.sql`. What it adds: `orders.queued_alert_sent_at` and two partial indexes (and, for anyone jumping from before v1.3.0, the `app_settings` table).

### Bugs fixed
1. **Possible double delivery / double wallet debit (most important).** Any error from Techlink — including a timeout or dropped connection *after* Techlink had already accepted the order — marked the order retryable, and the worker resubmitted it up to 5 times. `lib/techlink.js` now has a request timeout (`TECHLINK_TIMEOUT_MS`, default 20 s) and classes timeouts, dropped connections and 5xx responses as **ambiguous** (`TechlinkAmbiguousError`). An ambiguous order goes straight to `manual_review` (`fail_reason = provider_outcome_unknown`) and is never auto-retried; clear rejections (4xx, `success:false`, e.g. insufficient balance) still retry automatically.
2. **Urgent escalation could never fire.** The notify/escalate loop only saw an order on the single cron run that moved it into `manual_review` (≈0 minutes elapsed, so the 30-minute urgent threshold was never reached). It now also re-evaluates every un-escalated `manual_review` order on each run (`listManualReviewAwaitingEscalation`); every notification is still guarded by its own `*_notified_at` column, so nothing sends twice. **Expect urgent alerts for orders already sitting in manual review when you deploy.**
3. **Low-balance alert could silence itself.** Email failure skipped the SMS, and the cooldown started even when nothing was delivered. Channels are now independent and the cooldown starts only after at least one channel delivered.
4. **Wallet check ran last** in the cron, so an earlier failure or slow loop skipped it. It now runs first.
5. **Queued bulk orders starved the queue check.** Bulk queued orders without a provider `orderId` cannot auto-resolve, but filled every run's oldest-first batch. They are now excluded from the auto-check batch.
6. `/api/orders/verify` returned `status: "success"` for an order held in `manual_review`; it now returns 202 "processing".

### New behaviour
- **Bulk batches (data and airtime) are no longer marked delivered on a bare 2xx.** The Techlink docs we have show no example response for the bulk endpoints (the Postman page prints "No response body" for many endpoints that certainly return data, so this is a missing example, not proof of an empty response) — the real shape is **unknown**. `assessBulkResult` looks for per-row evidence using best-guess field names: an explicit failure signal → order held in `manual_review` (`bulk_partial_failure`; a retry would resubmit the whole batch, so the note says to verify recipients first); one success entry per row → delivered; nothing recognisable to check → **queued** until you confirm it with "Mark fulfilled manually". Set `BULK_AUTO_CONFIRM=true` to restore the old trust-the-2xx behaviour.
- **Stale queued-order alert.** Any queued order waiting longer than `QUEUED_ALERT_MINUTES` (default 180) alerts the admin once (email and SMS, channels independent); the claim is released if no channel delivered, so it retries next run.

### AFA registration field names
Techlink's docs disagree: the prose and the request-body definition say `fullName` / `ghanaCard` / `dob`; only the generated curl example says `name` / `idNumber` / `dateOfBirth` (the app used only the latter). `registerAfa` now sends both spellings. Confirm with one `tlg_test_` call (validated and priced, no wallet debit) and then keep whichever the response accepts.

### New env vars (all optional)
`TECHLINK_TIMEOUT_MS`, `QUEUED_ALERT_MINUTES`, `BULK_AUTO_CONFIRM` (see `.env.example`).

### Verification
All 90 `.js` files re-parsed (0 syntax errors), all relative imports and named exports re-resolved (0 problems), every `process.env.*` reference checked against `.env.example` (0 drift). The fulfillment path was exercised with a mocked store and Techlink (single ok / network drop / 400 rejection / bulk empty / bulk confirmed / bulk partial failure / MTN Master bulk, with and without `BULK_AUTO_CONFIRM`), and the alert paths with mocked Resend/Brevo (unconfigured / one channel down / both down). Not exercised against a live Supabase or live Techlink — do one end-to-end test with a `tlg_test_` key before relying on it.

## v1.3.5 Hardened / release-quality pass — September 24, 2026

Confirmed and implemented:
- Distributed Upstash rate limiting across API routes, with async `await` contract checks.
- Fixed-only pricing rules now override the default percentage margin.
- AFA registration data encrypted at rest for new orders with AES-256-GCM; fulfilled AFA payloads are cleared.
- Role-enforced admin operations.
- Order/support tracking moved from URL query strings to POST bodies.
- Customer contact prefill moved from persistent localStorage to sessionStorage.
- Paystack callback recovery preserves the order reference and retries verification.
- Production CSP enforcement.
- Techlink contract alignment verified against the supplied Business API V1 document, including Airtime, Data, ECG, Water, TV, Result Checkers, Agent Data Products, AFA, bulk orders and provider order verification.
- AFA request payload narrowed to the formally documented `fullName`, `ghanaCard`, and `dob` fields.
- Bulk Data/Airtime request bodies aligned with the documented examples.
- Added automated regression tests for pricing, AFA encryption, rate limiting and Techlink request contracts.
- CI now runs tests plus production contract checks before the Next.js build.

Evidence still required before calling the release fully production-ready:
- CI must complete `npm test` and `npm run build` successfully.
- A real/controlled end-to-end transaction must confirm payment → fulfillment → customer result.
- The production `AFA_ENCRYPTION_KEY` must be configured and migration `supabase/migration_v1_3_5.sql` applied.
- GitHub Actions, Supabase Vault and Vercel must hold the same `CRON_SECRET`; the new Vercel value must be deployed before the Supabase scheduler can be re-tested.
- A committed `package-lock.json` is still recommended once a machine/CI environment with npm registry access can generate it safely.
