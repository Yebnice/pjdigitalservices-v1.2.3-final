# v1.4.3

Techlink contract review. See REVIEW-FINDINGS.md section F and SYSTEM-ASSESSMENT-AND-DESIGN.md.

- Result-checker vouchers (serial + PIN) are delivered to the customer by the app, shown only to the owner, and kept out of the AI prompt.
- A Techlink test key or a testMode answer can never count as a delivery on the live site.
- Spending wallet money needs the admin role by default (WALLET_SPEND_ROLE=operator to relax).
- Held orders produce one digest, with the real reason, instead of an alert storm.
- Abandoned checkouts use one reason code everywhere; supabase/migration_v1_4_3.sql fixes saved rows.
- Every dashboard section is a table; daily close and audit/reconciliation/feedback exports added.
- Vercel cron second trigger (daily safety net).

SQL to run, in order: migration_v1_4_0.sql (if not yet), then migration_v1_4_3.sql.
