-- PjDigitalServices v1.3.5
-- Sensitive AFA data minimization.
--
-- New AFA submissions are encrypted by the application with AFA_ENCRYPTION_KEY.
-- Fulfilled historical AFA orders no longer need the registration identity
-- payload, so clear it to reduce retained sensitive data.
update public.orders
set afa_details = null
where lower(order_type) = 'afa'
  and fulfilled = true
  and afa_details is not null;
