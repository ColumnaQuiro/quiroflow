-- Repoints `plans` at LIVE-mode Stripe prices, in the new QuiroFlow platform
-- billing account (acct_1UD1lr0Ov3CXtGBc).
--
-- Until now these columns held test-mode price ids from the "Columnaquiro
-- sandbox" account (acct_1RVbK0P9Wga5q4zR) -- see 0133 and 0150. A test-mode
-- price id errors against a live-mode key, so no real clinic could ever have
-- completed checkout: this is the migration that makes the product sellable.
--
-- The account is also new. Platform billing used to be pointed at the same
-- Columnaquiro account that Connect uses to bill clinics' own patients; it now
-- has an account of its own, which is what server/utils/platformBillingStripe.ts
-- has always assumed ("Never share a client between the two").
--
-- Prices are unchanged from 0150 -- 59/50, 119/99, 199/169, all ex-VAT with
-- 21% IVA added via NUXT_STRIPE_PLATFORM_BILLING_TAX_RATE_ID -- with one
-- correction. The extra practitioner seat now bills 29 EUR on BOTH intervals
-- (348 EUR/year), where the old sandbox annual price was 25 EUR-equivalent.
-- `extra_professional_price_cents` is a single column that pages/subscription.vue
-- reads for both intervals, so the annual seat was being quoted at 29 EUR and
-- charged at 25.
--
-- DEPLOY ORDER: this must land together with the new account's
-- NUXT_STRIPE_PLATFORM_BILLING_SECRET_KEY and _WEBHOOK_SECRET on Netlify.
-- Live price ids against the old sandbox key fail exactly as badly as the
-- reverse. Nothing is mid-flight -- every account today is comped with no
-- Stripe subscription -- so there is no migration of existing subscribers to
-- worry about, but the two changes still have to ship as one.

update plans set
  stripe_monthly_price_id = 'price_1UDjko0Ov3CXtGBcIFRH7zxe',
  stripe_annual_price_id = 'price_1UDjlx0Ov3CXtGBcERDYPOuN',
  stripe_extra_professional_monthly_price_id = 'price_1UDjoj0Ov3CXtGBcTER5WDnK',
  stripe_extra_professional_annual_price_id = 'price_1UDjpD0Ov3CXtGBceRIEMWTC'
where id = 'starter';

update plans set
  stripe_monthly_price_id = 'price_1UDjmY0Ov3CXtGBcMSbN2SAb',
  stripe_annual_price_id = 'price_1UDjnA0Ov3CXtGBc5P4krqAu',
  stripe_extra_professional_monthly_price_id = 'price_1UDjoj0Ov3CXtGBcTER5WDnK',
  stripe_extra_professional_annual_price_id = 'price_1UDjpD0Ov3CXtGBceRIEMWTC'
where id = 'pro';

update plans set
  stripe_monthly_price_id = 'price_1UDjnb0Ov3CXtGBcoW8afGEA',
  stripe_annual_price_id = 'price_1UDjo70Ov3CXtGBcKQK6yau1',
  stripe_extra_professional_monthly_price_id = 'price_1UDjoj0Ov3CXtGBcTER5WDnK',
  stripe_extra_professional_annual_price_id = 'price_1UDjpD0Ov3CXtGBceRIEMWTC'
where id = 'clinic';
