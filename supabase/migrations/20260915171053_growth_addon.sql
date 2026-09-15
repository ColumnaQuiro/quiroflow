-- Growth as an add-on, not a fourth plan.
--
-- The plans are sized by capacity -- included_professionals,
-- included_clinics -- and Growth is not about capacity. A solo practitioner
-- buying Meta ads needs it exactly as much as a three-clinic group, and
-- making them buy seats they do not need in order to get it would be the
-- wrong trade. A fourth tier would also mean re-pricing and migrating every
-- existing customer; an add-on touches nobody who does not buy it.
--
-- It follows the shape the schema already has for extra professionals: a
-- column on the subscription, a price in a catalogue, and its own item on
-- the Stripe subscription. The difference is that extra professionals are a
-- quantity priced per plan, while Growth is one flat thing -- so its price
-- does not belong on `plans`, which is per-plan by definition.

-- The catalogue. One row today; a table rather than columns because the
-- upgrade panel needs to render a real price, and a price that lives in code
-- is a price that drifts from what Stripe actually charges. useGrowthPlans.ts
-- says exactly that about the fixture it currently reads.
create table addons (
  id text primary key,
  name text not null,
  monthly_price_cents integer not null,
  annual_price_cents integer not null,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  created_at timestamptz not null default now()
);

-- EUR 49 a month, EUR 39 billed annually.
--
-- Not the EUR 299 the upgrade panel was quoting: that was pricing for a
-- fourth tier, and it did not survive the change of shape. Against plans at
-- EUR 69 to EUR 199 a EUR 299 add-on costs more than the product it attaches
-- to, which makes it a separate purchase decision needing its own business
-- case rather than a line on the same invoice. The precedent already in this
-- schema is extra_professional_price_cents at EUR 25: add-ons here are
-- priced as increments.
--
-- Worth revisiting when the AI receptionist actually answers enquiries.
-- Growth has real marginal cost -- Meta bills per WhatsApp conversation and
-- the receptionist will burn model tokens per enquiry, which is why
-- usage_allowances exists at all -- but today it does not answer anything,
-- so what this price buys is leads, the drip and reputation. Priced for what
-- it does now rather than for what it might cost later.
--
-- The Stripe price ids stay null until somebody creates them; nothing can be
-- sold through Checkout until they exist.
insert into addons (id, name, monthly_price_cents, annual_price_cents) values
  ('growth', 'Growth', 4900, 3900);

alter table addons enable row level security;
-- Same reasoning as plans: a pricing catalogue is not account-specific and
-- an upgrade page needs to read it.
create policy "addons readable by any authenticated user" on addons
  for select to authenticated using (true);

alter table subscriptions add column growth_addon boolean not null default false;

comment on column subscriptions.growth_addon is
  'Whether this account has bought the Growth add-on. Checked server-side by requireGrowth, not only in the UI.';
