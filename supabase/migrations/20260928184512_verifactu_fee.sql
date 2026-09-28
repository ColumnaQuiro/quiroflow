-- The VeriFactu fee: 7,50 EUR a month per clinic location, ex-IVA, from the
-- day a clinic goes live (Settings > VeriFactu > "Live from a date"). The
-- same thing PracticeHub charges for fiscalising, and for the same reason:
-- every factura of a live clinic is transmitted to the AEAT's real service,
-- which is work QuiroFlow does for it every minute of every day.
--
-- Per LOCATION, so the quantity of one Stripe item follows the number of
-- active clinics -- the first thing billed here that follows a count in the
-- database rather than a number the owner picked. Kept in step by the
-- VeriFactu cron (server/utils/verifactuFee.ts), which already runs every
-- minute: it compares what should be billed with what is, here, and only
-- calls Stripe for an account where they differ.
--
-- The annual price is twelve monthly ones, with no annual discount: it is a
-- per-location service fee, not the plan.

insert into addons (id, name, monthly_price_cents, annual_price_cents, stripe_monthly_price_id, stripe_annual_price_id)
values (
  'verifactu', 'VeriFactu', 750, 750,
  'price_1UKjSC0Ov3CXtGBcM5Rh5c7H',   -- 7,50 EUR / month, per location
  'price_1UKjSC0Ov3CXtGBczjD111Un'    -- 90,00 EUR / year, per location
)
on conflict (id) do nothing;

-- What the subscription is BILLED for, as Stripe last said
-- (platform-billing-webhook), and when the cron last tried to change it. The
-- first is what the Subscription page shows; the second keeps a Stripe call
-- that fails (a past_due subscription cannot be changed) from being retried
-- every minute.
alter table subscriptions
  add column verifactu_locations integer not null default 0 check (verifactu_locations >= 0),
  add column verifactu_fee_attempted_at timestamptz;

comment on column subscriptions.verifactu_locations is
  'Quantity of the VeriFactu fee item on the Stripe subscription (per active clinic location). Written by the platform billing webhook; the cron brings it in line with verifactu_fee_locations().';

-- How many locations SHOULD be billed right now: every active clinic of an
-- account that is live on VeriFactu and whose live date has come. Zero for
-- everyone else -- off, test, or live from a date still ahead.
create or replace function public.verifactu_fee_locations(p_account_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
           when a.verifactu_mode = 'live'
                and a.verifactu_production_from is not null
                and a.verifactu_production_from <= p_at
             then (select count(*)::integer from clinics c where c.account_id = a.id and c.archived_at is null)
           else 0
         end
  from accounts a
  where a.id = p_account_id
    -- Its own account only, for a signed-in caller; the cron has no uid.
    and (auth.uid() is null or is_account_member(a.id));
$function$;

-- The accounts the cron has to bring in line: a Stripe subscription to put
-- the item on, not comped (a comped account is not billed at all), and a
-- billed quantity that is not what it should be. An account tried in the last
-- fifteen minutes waits, so one Stripe refusal is not a call a minute.
create or replace function public.verifactu_fee_out_of_sync(p_limit integer default 10)
returns table (account_id uuid, billed integer, due integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.account_id, s.verifactu_locations, verifactu_fee_locations(s.account_id)
  from subscriptions s
  where s.stripe_subscription_id is not null
    and not s.comped
    and s.status in ('trialing', 'active', 'past_due')
    and s.verifactu_locations <> verifactu_fee_locations(s.account_id)
    and (s.verifactu_fee_attempted_at is null or s.verifactu_fee_attempted_at < now() - interval '15 minutes')
  order by s.verifactu_fee_attempted_at nulls first
  limit p_limit;
$function$;

revoke all on function public.verifactu_fee_out_of_sync(integer) from public, anon, authenticated;
-- The quantity itself is not a secret: Settings > VeriFactu shows the owner
-- what going live will cost.
revoke all on function public.verifactu_fee_locations(uuid, timestamptz) from public, anon;
grant execute on function public.verifactu_fee_locations(uuid, timestamptz) to authenticated;
