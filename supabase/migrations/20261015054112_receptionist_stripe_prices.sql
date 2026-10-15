-- The AI receptionist's Stripe prices, so it can be bought.
--
-- Created in the platform billing account (acct_1UD1lr0Ov3CXtGBc) on
-- 2026-10-15, product prod_VRaa8HEsLTweyp "QuiroFlow AI receptionist", tax
-- code txcd_10000000 like the other products. Excluding IVA, which Stripe
-- adds through default_tax_rates. Until these were set, subscribe refused the
-- add-on rather than leaving it off the subscription
-- (20261014184755_receptionist_addon.sql).
--
-- The overage blocks (EUR 15 per 1,000 replies past the allowance) need no
-- price: receptionist-overage-cron bills them as an amount on an invoice line.
update addons set
  stripe_monthly_price_id = 'price_1UQhPN0Ov3CXtGBcbKdae8qw',  -- 19,00 EUR / month
  stripe_annual_price_id = 'price_1UQhPN0Ov3CXtGBcLlZtRKsj'    -- 204,00 EUR / year (17 EUR/mo)
where id = 'receptionist';
