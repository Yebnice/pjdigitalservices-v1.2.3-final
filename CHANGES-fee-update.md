# Fee-handling update (Priority 1 from the risk review)

## Deploy in this order
1. **Run `supabase/migration_v1_3_7.sql`** in the Supabase SQL editor (adds `paystack_fee_actual` and `paystack_net_settled`).
   The code still works if you forget: it logs a warning and verifies the payment without recording the fee.
2. Deploy the code.
3. Make 3-5 small real payments and check `paystack_fee_actual` against `paystack_fee_amount` on those orders.
   This also tells you whether Paystack rounds its fee to the nearest pesewa or up (we assumed either).

## What changed
| # | Change | Where |
|---|---|---|
| 1 | Gross-up now follows Paystack's documented formula: `Price / (1 - 0.0195) + 0.01`. Zero stays zero. Customers pay 1 pesewa more (GHS 4.49 product: 4.58 -> 4.59). | `lib/pricing.js` |
| 1 | Property test: for every price GHS 0.01-500.00, settled net is never below the product price, under both "fee rounds to nearest" and "fee rounds up". Fails if the `+ 0.01` is removed. | `tests/paystackFeeRounding.test.js` |
| 2 | "Price + payment processing fee = Total to pay" shown before the Pay button on every single-order page. | `components/ui.js` (`PriceBreakdown`), all pages, `TierShop.js` |
| 3 | One calculation: `previewBreakdown()` calls the server's `getOrderPricing()`. Price-shown guard: if the server total differs from the total shown, the customer must confirm the new amount before the Paystack popup opens; otherwise the order is abandoned. | `lib/pricing.js`, `lib/priceGuard.js`, `lib/payment.js` |
| 4 | Paystack's real `fees` (from the verify response) and net settlement are stored per order. An audit-log alert is raised when we settle below the product price (`paystack_net_below_price`) or the fee differs from our estimate (`paystack_fee_differs`). Never blocks delivery. | `lib/feeCheck.js`, `lib/store.js`, `lib/orderProcessing.js` |

## Known limits
- Bulk **data** estimates are summed from per-line catalogue prices, so the guard allows 0.01 + 0.005 per line of rounding drift. Single orders and bulk airtime are exact.
- The guard uses the browser's built-in `confirm` dialog on purpose (blocking, accessible, works on every phone).
- Not included (Priority 2/3): server-side `initialize` + `resumeTransaction`, the mismatch-hold state, the airtime margin decision, scheduled reconciliation.
