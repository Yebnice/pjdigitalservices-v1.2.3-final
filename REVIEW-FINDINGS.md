# Review findings register: v1.4.3

Method: read the code paths that spend money (payment verification, worker, admin actions, webhook queue, database
schema), then attacked my own v1.4.0 changes with "what if" cases. Every defect below was first REPRODUCED by a
failing test, then fixed, then the test passed. Tests are in `tests/e2e/delivery-safety.e2e.mjs` and `tests/e2e/price-guard.e2e.mjs`.

## A. Defects found and fixed this round

| # | Sev | Defect | Effect | Test |
|---|-----|--------|--------|------|
| 1 | High | A paid checkout that had been closed as "abandoned" (customer closed the popup, then approved a mobile-money prompt) could not be held for review: the update silently matched nothing but the code reported "held". | Customer paid, nothing delivered, nothing on Needs attention. | DEAD END ... abandoned-then-paid (manual mode) |
| 2 | High | Last-mile age rule measured from checkout creation. The cron worker (GitHub schedules are best-effort) is the ONLY deliverer of webhook-paid orders. | A late cron run would park genuinely paid orders for manual approval. | FALSE HOLD ... cron runs an hour late |
| 3 | Med | Checkouts whose Paystack popup never opened (also: customer declines the new price) make Paystack answer "reference not found", which was treated as an error. | Every check reported errors forever; `/api/orders/verify` returned 500; ghosts never closed. | DEAD END ... popup never opened (x2) |
| 4 | Med | An unreadable delivery-mode setting (one database blip) failed closed by PARKING the order for manual approval. | Paid orders turned into manual work after a one-second outage. | FALSE HOLD ... database blip (x2) |
| 5 | Med | My guard for #1 would have thrown on a duplicate Paystack notification for an order already accepted and delivered. | Webhook queue flooded with retries. Caught before shipping. | a SECOND Paystack notification ... quiet no-op |
| 6 | Low | Customer page retried 3x and said "could not complete the status check" for a test-mode or wrong-reference rejection. | Misleading message. | a TEST-mode / wrong-reference rejection is explained |
| 7 | Low | PDF guide claimed pausing the GitHub workflow stops all automatic delivery. | False comfort: the customer's own verify call also delivers. | corrected in the PDF (Part 1) |
| 8 | Low | No warning that rate limits are per-server when Redis is not configured. | Login throttling weaker than it looks. | dashboard banner + `/api/admin/health` |

## B. Checked and found sound (no change)

- CSV export neutralises spreadsheet formulas. Sessions: HMAC, timing-safe, invalidated on password change. Passwords: scrypt. Reset/verify tokens: hashed, expiring.
- Every public API route is rate limited (except logout and the read-only reviews list). No `dangerouslySetInnerHTML`.
- The abandon endpoint asks Paystack first, so it cannot cancel a paid order.
- Duplicate delivery guard on ambiguous Techlink outcomes: the order goes to manual review with an evidence check.
- RLS enabled on all 7 tables, no policies/views/functions, server uses the service key only (grants now revoked by the migration).

## C. Open risks and decisions (NOT changed; need an owner)

1. **Airtime loses about 2% per order** (Techlink wallet fee is not in the customer price). Decide: raise margin above 2%, set a minimum, or keep as a loss leader.
2. **No idempotency/client reference with Techlink.** After an ambiguous outcome a person decides using Techlink's order history. Ask Techlink whether a client reference is supported.
3. **Operators can press Approve & deliver** (spends wallet). Restrict to admin if you want two-person control.
4. **GitHub cron is the only deliverer of webhook-paid orders.** Add a second trigger (Vercel Cron or an external pinger). Customers' own verify call covers most orders.
5. **Held orders send one admin alert email each (up to 50 per cycle) and one customer "delay" notice.** First "Check outstanding orders" after deploy may send many. Expect it.
6. **Paystack amount is still set in the browser** (server-side `initialize` + `resumeTransaction` not yet enabled). Tampering only hurts the tamperer; the price guard and amount check already protect you.
7. **Dashboard profit is an estimate** (`charged x (1 - 1.95%) - cost`). `paystack_net_settled` now holds the real figure for new orders and could replace it.
8. **Vercel preview deployments allow test payments by design.** Never point a preview at the production database or live Techlink key.
9. **Rate limits are per-server until Redis is configured.**

## D. What was NOT verified (be honest about it)

- The SQL has not been executed on a real Postgres/Supabase (none available). Rehearse on a scratch project (PDF step 3.4).
- No `next build`, no browser or phone test. Components were rendered to HTML and checked, not clicked.
- 31 original unit tests cannot run in my stand-in runner (they use `vi.mock` etc.). They fail identically on the original code. Run `npm test`.
- Your live database, Paystack account and Techlink history are unseen, so the root cause of the two unpaid orders is unproven. Part 2 of the PDF shows how to find it.

## E. Round 3: bookkeeping and customer-service review (v1.4.2)

Same method: evidence first, failing test, fix, passing test, then break the fix on purpose to prove the test notices.
Tests: `tests/e2e/bookkeeping-support.e2e.mjs` (16 scenarios).

| # | Area | Verified fact | Fix |
|---|------|---------------|-----|
| 9 | Books | `reconcile.js` compared money with `Math.abs(a-b) < 0.01`. In JavaScript that accepted a 1-pesewa difference for GHS 4.59 vs 4.58 but flagged it for GHS 102.00 vs 101.99 (4 of 8 sample pairs were hidden). A 1-pesewa drift is exactly what fee rounding produces. | Compare in whole pesewas. Mismatches now report `differenceGhs`. |
| 10 | Books | A negative amount in the CSV ("-4.59", "(4.59)") had its sign stripped and could "match" a normal payment. | Sign is kept, so a refund-style row is flagged. (Paystack's real export format for refunds is NOT verified: see D.) |
| 11 | Books | `enqueuePaystackWebhook` drops every event except `charge.success`. A refund or dispute on a delivered order was invisible until a manual CSV reconciliation. | Paystack-documented events `refund.pending/processing/processed/failed` and `charge.dispute.create/remind/resolve` are verified by signature, matched to the order, and written to the audit log. Record-only: order state is never changed. De-duplicated. A database failure answers 5xx so Paystack retries. The dashboard shows a 30-day count. |
| 12 | Support | Every customer email and SMS used only the internal `TL...` reference while the site and receipt show `PJ-XXXXXXXX`. | Emails and SMS lead with the order number and keep the Paystack reference. SMS stays under 160 characters. Orders without a number fall back to the reference. |
| 13 | Support | Site copy (home, FAQ, dashboard, feedback, reviews, chat) told customers to use "the order reference", with a `TL...` placeholder. | Wording and placeholders now say order number (PJ-). The lookups already accepted both. |

### New open items from round 3 (not changed)
- **Refund payload fields are not verified.** Paystack's docs confirm the event NAMES; the search results did not show payload field names. The matcher therefore looks for any text value equal to one of your order references. Confirm with a real event: Paystack Dashboard, Developers, Webhooks (event history), and compare with your Audit tab.
- **Whether Paystack sends refund/dispute events to your URL by default is not verified.** Check the same Webhooks history page.
- **Revenue is not netted for refunds.** The overview books revenue on delivered orders by creation date and does not subtract a later refund. The new audit rows give you the trail; amounts must be taken from Paystack.
- **Admin alert emails and the AI assistant's canned replies still say "reference".** Left unchanged; the admin dashboard searches both numbers.


## F. Round 4: Techlink contract review (v1.4.3)

Source of truth for this round: the Techlink Business API V1 Postman document you supplied. Suite: `tests/e2e/techlink-contract.e2e.mjs`
(31 scenarios; its fake Techlink REJECTS any request that does not match the document). Full scoring and design: `SYSTEM-ASSESSMENT-AND-DESIGN.md`.

### F1. Assumptions register (VERIFIED = checked against the document, the code, or a test; UNVERIFIED = I could not check it)

| # | Claim | Status | Basis |
|---|-------|--------|-------|
| 1 | Base URL `https://api.techlinkgh.com/api/v1`, header `x-api-key` with `tlg_live_` / `tlg_test_` keys | VERIFIED | Document intro + `lib/techlink.js` |
| 2 | Request bodies for airtime, data bundle, MTN Express/Master (`/orders`), ECG, water, TV, voucher and AFA match the document exactly | VERIFIED | 9 contract tests; fake rejects deviations |
| 3 | AirtelTigo is sent as `AT` | VERIFIED | Document enum + contract test |
| 4 | Airtime is debited at face value + the service fee; the fee comes from `GET /products/airtime-fee` (document example 2%) | VERIFIED (example) / UNVERIFIED (your live rate) | Document + `create.js` reads it live |
| 5 | The airtime fee is not in the customer's price, so airtime loses about the fee per order | VERIFIED | Document statement + pricing code + dashboard shows margin -GHS 0.02 on GHS 2 airtime |
| 6 | No request carries an idempotency key or client reference | VERIFIED | Every body in the document; client code |
| 7 | The voucher purchase request has no recipient field | VERIFIED | Document + `purchaseChecker()` |
| 8 | The voucher response carries `checkers: [{serialNumber, pin, type}]` | VERIFIED | Document example |
| 9 | Where Techlink sends the "email/SMS" voucher when there is no recipient | UNVERIFIED | Cannot be known from the document. Verify: buy one voucher, then `curl -H "x-api-key: $KEY" https://api.techlinkgh.com/api/v1/result-checker/my` and check which inbox received it |
| 10 | `POST /orders/:id/verify` returns `status: "completed"` when done | VERIFIED (that value) / UNVERIFIED (the other status values) | Document example only |
| 11 | Response shape of `POST /orders` (agent products) | UNVERIFIED | The document shows no example response; the fake assumes `{success, orderId, status:"processing"}` |
| 12 | A test key returns `testMode: true` and delivers nothing | VERIFIED for AFA only / UNVERIFIED elsewhere | Document says so for AFA; the guard is precautionary for all products |
| 13 | AFA field names | UNVERIFIED | The document's JSON body (`fullName`, `ghanaCard`, `dob`) and its curl example (`name`, `idNumber`, `dateOfBirth`) disagree; the app sends the JSON-body names |
| 14 | Validation endpoints (`/korba/validate` with `billType`, `/provider/validate` with `billType` or `service`) | UNVERIFIED | Inconsistent in the document; purchases are contract-tested, validation calls are not |
| 15 | Vercel Cron: GET only, `Authorization: Bearer CRON_SECRET`, Hobby daily only, Pro per-minute, production only | VERIFIED | Vercel documentation |
| 16 | Paystack event names `refund.*`, `charge.dispute.*` | VERIFIED | Paystack documentation |
| 17 | Paystack refund/dispute payload field names; whether they are sent to your URL by default | UNVERIFIED | Handler does not depend on field names |
| 18 | Supabase default grants give `anon`/`authenticated` table access | VERIFIED | Supabase documentation |
| 19 | The SQL runs on real Postgres | UNVERIFIED | No Postgres available |
| 20 | `next build`, browser and phone behaviour | UNVERIFIED | Not run |
| 21 | What caused your two unpaid orders | UNVERIFIED | Needs your database and Paystack account (PDF Part 2) |
| 22 | The screenshot rows are this app's orders | VERIFIED (consistent) / UNVERIFIED (cause) | MTN Express 1GB at 4.70 and airtime 2.04 = 2 x 1.02 match the code |

### F2. Defects found this round

Each: failing test first, root cause, minimal fix, regression test, then a deliberate break (mutation) that the test caught.

| ID | Defect | Root cause | Fix | Side effects / notes |
|----|--------|-----------|-----|----------------------|
| B1 | Customer paying for a result-checker voucher never receives the serial/PIN, yet is told it was delivered | Request has no recipient; `sanitizePublicResult` dropped `checkers`; no email/SMS carried a PIN | `lib/vouchers.js`; owner-only `checkers` in the public result; PIN(s) in the delivered email or one SMS each; shown in both receipts | PINs are stored in `orders.result` unencrypted (as before). Where Techlink itself sends them is UNVERIFIED (#9) |
| B2 | "success" without vouchers was marked delivered | No completeness check | Fewer vouchers than bought: held for a human, customer not told "delivered" | Alerts per order (real incident) |
| B3 | A Techlink test key or a `testMode` answer would mark orders delivered | No key-mode or response check | Test key in production: nothing sent, order stays ready and delivers when a live key is set; `testMode:true`: held; red banner; `GET /api/admin/health` reports `techlink.keyMode` | `ALLOW_PAYSTACK_TEST_PAYMENTS=true` relaxes both for staging |
| B4 | Electricity tokens were sent to the AI provider | `JSON.stringify(toPublicOrder(order))` in the prompt; `result.token` is in the public shape | `result` stripped from the prompt | Assistant can no longer quote a token (it never needed to) |
| B5 | Any operator could spend wallet money | `orders.process` covered Approve, Send now, Retry | New `orders.spend_wallet` permission, admin by default; `WALLET_SPEND_ROLE=operator` relaxes; buttons disabled with the reason | **Behaviour change.** Operators can still check and verify. Operators can never force a retry |
| B6 | 6 held orders produced 12 admin emails and 6 SMS (each SMS up to 918 characters); the email gave the wrong reason | Held orders went through the incident loop | One digest (and one urgent digest + one SMS after `HELD_URGENT_HOURS`); true hold reason in every alert; real incidents still alert per order | Customers still get one notice each |
| B7 | Checkouts closed as abandoned appeared to customers as "Payment failed" | Sweep stored Paystack's `abandoned`; the site looks for `payment_abandoned` (9 places) | Store `payment_abandoned`; one shared `isAbandonedOrder`; `migration_v1_4_3.sql` fixes saved rows | Run the migration |
| B8 | (own bug, caught before release) Audit tab alert count ignored prefix-matched alerts | Exact-name list only | One `isAlert()` | none |

### F3. Decisions 1 to 7 (status after this round)

1. **Airtime loses the wallet fee**: now VERIFIED from the document. Not changed (changing the customer price alters your business model and needs the browser preview to learn the new price). Options and cost in section 4 of the assessment.
2. **No client reference**: VERIFIED. Cannot be fixed by us; ask Techlink. `callbackUrl` exists but is unused.
3. **Operators spending**: DONE (B5), admin-only by default.
4. **Second trigger**: DONE as a daily safety net (`vercel.json`); on a Pro plan change the schedule to every 5 minutes.
5. **Per-server rate limits**: warned on the dashboard; fix is configuration (Upstash/Redis).
6. **Alert flood**: DONE (B6). **Why orders are held**: see section F4.
7. **Browser-set Paystack amount**: unchanged; roadmap item 2.

### F4. Why an order is held (the five reasons, each shown in the order's own text)

| Reason | Meaning | Who releases it |
|--------|---------|-----------------|
| Delivery mode is MANUAL | You switched on the safety switch | Admin: Approve & deliver |
| Discovered late (older than `AUTO_DELIVERY_MAX_AGE_MINUTES`, default 45) | Paystack confirms payment, but the checkout was already old when we noticed | Admin |
| Found by "Check outstanding orders" | A check records payments; it never delivers | Admin |
| No payment record / recorded amount too small / verified too long ago (`AUTO_RETRY_MAX_VERIFIED_HOURS`, 6) | The last-mile re-check refused | Admin, after looking |
| Techlink problem (ambiguous result, test mode, missing vouchers) | Money may have been spent, or nothing delivered | Admin, after checking Techlink |

### F5. The three questions

* **Paid airtime, automatic mode, live payment, fresh checkout**: not held; delivered at once (test `Q1`). It is held only in the four situations in F4's first four rows, or blocked if the payment was test-mode.
* **MTN Master**: after payment Techlink accepts it and the app marks it **queued** (customer emailed "queued", never "delivered"); the worker asks Techlink's verify endpoint and marks it delivered only when Techlink says `completed`; it is never re-sent while queued (test `Q2`). In manual mode it is held *before* sending, and queued after approval.
* **Three uncompleted checkouts**: abandoned at Paystack = closed; actually paid = held awaiting approval (nothing delivered by the check); never opened = closed after 60 minutes. Delivery needs an admin (test `Q3`).
