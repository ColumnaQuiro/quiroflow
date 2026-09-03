-- Stripe Price IDs for each plan's monthly/annual subscription, plus the
-- shared "extra professional" seat add-on (Starter/Pro only -- Clinic is
-- unlimited, same as extra_professional_price_cents already being null
-- there). These are QuiroFlow's own Stripe account/prices (billing the
-- clinic for the product itself) -- unrelated to any clinic's own
-- stripe_connect_account_id, which bills their patients.
--
-- Populated below with TEST-MODE price IDs from the "Columnaquiro sandbox"
-- Stripe account (acct_1RVbK0P9Wga5q4zR) -- these only work against that
-- account in test mode. Moving to production means creating the same
-- Products/Prices again in the real, live-mode Columnaquiro account and
-- updating these columns to the resulting live price IDs; a test-mode price
-- ID is meaningless (and will error) against a live-mode API key.
alter table plans add column stripe_monthly_price_id text;
alter table plans add column stripe_annual_price_id text;
alter table plans add column stripe_extra_professional_monthly_price_id text;
alter table plans add column stripe_extra_professional_annual_price_id text;

update plans set
  stripe_monthly_price_id = 'price_1UBbIQP9Wga5q4zRQL4xhjZh',
  stripe_annual_price_id = 'price_1UBbJdP9Wga5q4zRno4Ejnxo',
  stripe_extra_professional_monthly_price_id = 'price_1UBbJPP9Wga5q4zRFvne1Uzv',
  stripe_extra_professional_annual_price_id = 'price_1UBbNHP9Wga5q4zR73EmQYqo'
where id = 'starter';

update plans set
  stripe_monthly_price_id = 'price_1UBbIYP9Wga5q4zRnnZzcjQf',
  stripe_annual_price_id = 'price_1UBbJvP9Wga5q4zRxXTsCeff',
  stripe_extra_professional_monthly_price_id = 'price_1UBbJPP9Wga5q4zRFvne1Uzv',
  stripe_extra_professional_annual_price_id = 'price_1UBbNHP9Wga5q4zR73EmQYqo'
where id = 'pro';

update plans set
  stripe_monthly_price_id = 'price_1UBbJGP9Wga5q4zRTsFgJFev',
  stripe_annual_price_id = 'price_1UBbKTP9Wga5q4zRBMu2tXvQ'
where id = 'clinic';
