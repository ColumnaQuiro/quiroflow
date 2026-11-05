-- A bono can cost something different depending on how many plazos it is
-- paid in: "Bono 10 sesiones" at 500 EUR paid at once, 2 x 250 EUR, or
-- 3 x 180 EUR (540 EUR in all -- a split may cost more than paying up front,
-- and each option is priced by the clinic, not derived from the others).
--
-- The template's price_cents stays the one-payment price, which is what every
-- path that does not choose an option keeps selling at: gift vouchers (paid
-- in full by whoever buys them), the staff app, and anything already live
-- that reads only price_cents. The split options sit beside it.
--
-- A sale records the option it was made under. price_cents on the purchase is
-- that option's TOTAL, so everything that already works off it is right
-- without knowing about plazos: owed_cents starts there, each visit is
-- charged at price / sessions, and a payment's factura says how much of that
-- total it bought. installments and installment_cents say how it is paid,
-- which is what decides how much of what is still owed is due yet: a plazo
-- falls due once the sessions already paid for have been used
-- (utils/bonoInstallments.ts). Null on both is a bono paid at once, which is
-- every bono sold before this.
--
-- No new table and no patient_id: the options are a column on packages and
-- the plan two columns on package_purchases, both already audited
-- (20261008070424_audit_trail.sql) and already under their tables' policies.

alter table packages
  add column installment_options jsonb not null default '[]'::jsonb;

comment on column packages.installment_options is
  'Prices for paying this bono in plazos, beside price_cents (paid at once): [{"installments": 2, "installment_cents": 25000}, ...]. Each option is N equal plazos of installment_cents, priced freely. Sorted by installments, at most one option per number of plazos.';

-- Shape checked here rather than trusted to the settings screen: an option
-- with a fractional or zero count reaches the sale as a price nobody set.
create or replace function public.package_installment_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  -- CASE rather than AND throughout: SQL does not promise to evaluate an AND
  -- left to right, and a cast reached before its regex would raise instead
  -- of answering false.
  select case
    when jsonb_typeof(p_options) is distinct from 'array' then false
    when jsonb_array_length(p_options) > 12 then false
    else coalesce((
      select bool_and(
               case
                 when jsonb_typeof(o) <> 'object' then false
                 when coalesce(jsonb_typeof(o -> 'installments'), '') <> 'number'
                   or coalesce(jsonb_typeof(o -> 'installment_cents'), '') <> 'number' then false
                 when (o ->> 'installments') !~ '^[0-9]{1,2}$'
                   or (o ->> 'installment_cents') !~ '^[0-9]{1,9}$' then false
                 else (o ->> 'installments')::int between 2 and 24
                  and (o ->> 'installment_cents')::int <= 100000000
               end)
         and count(distinct o ->> 'installments') = count(*)
        from jsonb_array_elements(p_options) o
    ), true)
  end
$$;

alter table packages
  add constraint packages_installment_options_valid
  check (public.package_installment_options_valid(installment_options));

alter table package_purchases
  add column installments integer,
  add column installment_cents integer;

comment on column package_purchases.installments is
  'How many plazos this bono was sold in, when it was sold under a split option of its template (packages.installment_options). Null: paid at once. price_cents is then installments x installment_cents.';
comment on column package_purchases.installment_cents is
  'What each plazo costs, when the bono was sold in plazos. See installments.';

-- The plan and the price are one statement about the sale; letting them
-- disagree would make "what is due" and "what is owed" two different bonos.
alter table package_purchases
  add constraint package_purchases_installment_plan
  check (
    (installments is null and installment_cents is null)
    or (installments between 2 and 24 and installment_cents >= 0 and price_cents = installments * installment_cents)
  );
