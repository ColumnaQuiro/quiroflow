-- The price of a clinic's own brand in the patient app
-- (20261111063546_patient_app_branding.sql): EUR 15 a month, EUR 13 a month
-- billed annually (EUR 156 a year), excluding IVA like every price here.
--
-- Priced on what it is worth, not on what it costs: unlike the AI
-- receptionist, where every reply is a paid model call, a clinic's colours
-- cost nothing to serve. EUR 15 sits under the receptionist's EUR 19, is a
-- third on top of Solo and barely shows on Practice, and leaves room above it
-- for a clinic's own app in the stores, which has to cost a good deal more.
-- The annual figure is the same ~10% off the other add-ons give.
--
-- Its own add-on and nothing else: no plan includes it, Growth does not
-- include it, and the trial does not give it. subscribe.post.ts therefore
-- leaves it alone unless a request names it, and the billing webhook writes
-- subscriptions.branding_addon from the Stripe items exactly as it writes the
-- other two -- so a flag set by hand is overwritten by the next Stripe event.
-- An account given it for free is `comped`, which get_clinic_branding() reads.
--
-- The prices are in the platform's Stripe account (product
-- prod_Vbiw1Pz7DXvhaQ, "QuiroFlow brand in the patient app").
insert into addons (id, name, monthly_price_cents, annual_price_cents, stripe_monthly_price_id, stripe_annual_price_id)
values (
  'branding', 'Your brand in the patient app', 1500, 1300,
  'price_1UaVUA0Ov3CXtGBctGmxhh7F',   -- 15,00 EUR / month
  'price_1UaVUM0Ov3CXtGBci9JabgNY'    -- 156,00 EUR / year
)
on conflict (id) do nothing;
