-- v1.3.12 hardening
-- 1) One review per order, enforced by the database (the app-level "already
--    reviewed?" check alone can be raced by two simultaneous submissions).
-- Keep the oldest review for any order that somehow has more than one.
delete from reviews r
using reviews keep
where r.order_reference = keep.order_reference
  and (r.created_at, r.id) > (keep.created_at, keep.id);

create unique index if not exists reviews_order_reference_uq
  on reviews (order_reference);

-- 2) Password-reset and email-verification tokens are now stored as SHA-256
--    hashes. Tokens issued before this deploy are plain text and will no
--    longer match, so clear them; customers just request a new link.
update customers
   set reset_token = null, reset_expires_at = null,
       verification_token = null, verification_expires_at = null
 where reset_token is not null or verification_token is not null;
