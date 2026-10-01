# PjDigitalServices – code & UI audit (v1.3.12)

## Do these 4 things when you deploy

1. **Run `supabase/migration_v1_3_6.sql`** in the Supabase SQL editor (adds a unique index so one order can only ever get one review; clears old plain-text reset/verify tokens).
2. **Set `NEXT_PUBLIC_SITE_URL=https://www.pjdigitalservices.online`** in Vercel (must be `https`, no trailing slash). Verification and password-reset emails are built from it.
3. Optional: set `MIN_ORDER_AMOUNT_GHS` (default `1`) if Techlink's minimum for airtime / ECG differs.
4. Expect: customers are logged out once (sessions are now tied to the password), and any reset/verify link sent before the deploy stops working (they request a new one).

## Money path
| Issue | Fix |
|---|---|
| Result-checker order stored the **raw client object**, discarding the validated one (`quantity:[2]`, `"0x2"`, `"SMS"` could reach the provider) | Removed the overwrite – the validated object is what's stored and sent |
| Airtime / ECG / bulk-airtime accepted `0.5`, `10.005`, `1e-9` – provider rejects *after* payment → manual refund | Server enforces ≤2 decimals and a minimum (`MIN_ORDER_AMOUNT_GHS`) |
| ECG "verify meter first" was enforced by the page only | Server now re-verifies the meter before creating the order |
| AFA / TV details stored arbitrary client JSON; `afaDetails`, `tvDetails`, `meterNumber`, `bundleId` saved on unrelated order types | Whitelisted, length-capped, stored only for the matching order type |
| Bulk totals summed floats (`0.1+0.2`) → possible amount mismatch at verification | Rounded to pesewas |
| Currency check passed when Paystack omitted currency | Must be exactly `GHS` |
| `PAYSTACK_FEE_RATE=""` / `DEFAULT_BUSINESS_MARGIN_PERCENT=""` silently became **0%** | Blank env values are treated as unset |
| Missing `PAYSTACK_SECRET_KEY` made the webhook throw | Fails closed with a clear error |
| `/orders/verify` & `/orders/abandon` returned the full order (incl. ECG token) to anyone holding a reference | Token/result only returned when the matching email is supplied |
| Double-tap on Pay created two orders / two popups | One checkout at a time per tab |
| Customer charged but amount didn't match → told to "retry" | Clear message: don't pay again, contact support with the reference |
| IP-only limits (12/min) hurt real customers behind Ghana's carrier NAT, yet were weak against abuse | Higher per-IP limits **plus** per-email / per-reference limits |

## Accounts & auth
| Issue | Fix |
|---|---|
| Customer session with no `exp` never expired (fail-open) | Fail-closed |
| Password reset didn't end existing sessions | Session carries a password fingerprint; reset/change invalidates it |
| Login timing revealed which emails/usernames exist | Dummy password check for unknown accounts |
| Login limited per IP only (botnet could grind one account) | Added per-account limit |
| Reset / verification tokens stored in plain text | Stored as SHA-256 hashes |
| `forgot-password`: anyone could invalidate a user's valid link or mail-bomb them | Per-address limit + 2-minute cooldown, identical response either way |
| **Account pre-hijack:** attacker registers victim's email with their own password, victim later verifies | Registering over an *unverified* email takes the account over; a completed reset also proves ownership |
| Login used a string-built `.or()` filter | Single-column exact lookup |
| Malformed cookie (`%E0%A4%A`) threw in the request | Safely ignored |
| Logout cookie was cleared without `Secure` | Same attributes as set |

## Other server fixes
- Complaint form: field type/length caps, valid-date check; case lookup now tolerant of lowercase references and `024 123 4567` phone formats.
- Reviews: unique index + friendly error on a double submit.
- `My orders`: one failing provider re-check no longer breaks the whole list.
- Verification/reset email links: `https`, never a relative or `http://localhost` link.
- CSV export escapes `\r`; rate-limiter memory map hard-capped; `req.body` null-safe on techlink proxies; AI-chat input capped.

## UI
- **Customers saw "Margin GHS 0.00" on every order** (wrong, and internal). Removed.
- Mobile menu had **no Log in / Log out and no Privacy / Terms / Refunds**. Added. "Create Account" hidden once logged in. Menu button has `aria-label` / `aria-expanded`.
- ECG token / voucher details now shown on the receipt and order list when present (verified owner only). "N/A" recipient hidden.
- Verify-email page fired its single-use token twice under React StrictMode, showing "expired" after success. Guarded.
- Reset page with a missing token now says so. Data page: bundles cleared when the phone changes; slow/stale responses can't overwrite newer ones.
- Money inputs: decimal keypad, `min`, `step`, and mouse-wheel no longer changes the value.
- Keyboard focus is now visible on buttons, links, selects and textareas.
- Form accessibility: every input has an `id`, `name` and a linked/aria label (the DevTools warnings).

## Not changed (your call)
- **Paystack amount is set in the browser popup.** Tampering only hurts the tamperer (server rejects a wrong amount), but initialising the transaction server-side (`access_code`) is cleaner and removes "charged but rejected" cases.
- Registration still says "email already registered" (normal trade-off; login and reset do not leak).
- The "Not secure" badge in your normal Edge profile is local to your browser (InPrivate showed a padlock).
- I could not run the app against live Supabase/Techlink/Paystack here. Syntax checks pass on all 114 files, and your test-suite results are identical before/after (no regressions); please run `npm test` and one sandbox purchase per product before going live.
