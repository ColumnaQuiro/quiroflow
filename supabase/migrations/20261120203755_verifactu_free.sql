-- VeriFactu is free: the 7,50 EUR a month per location fee from
-- 20260928184512_verifactu_fee.sql is no longer charged to anyone.
--
-- Done by making what is DUE zero for every account, rather than by taking
-- the machinery out. The VeriFactu cron (server/utils/verifactuFee.ts) keeps
-- every subscription's fee item in line with this function, so an account
-- still carrying the item would have it removed (prorated) on the next tick,
-- and subscribe/preview stop adding it to new or changed subscriptions. When
-- this was written no subscription was billed for it (verifactu_locations = 0
-- everywhere), so in practice it only stops the charge from ever starting.
--
-- The `addons` row stays: its Stripe price ids are how the cron and the
-- billing webhook recognise the item, should one ever need removing.
create or replace function public.verifactu_fee_locations(p_account_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select 0
  from accounts a
  where a.id = p_account_id
    and (auth.uid() is null or is_account_member(a.id));
$function$;
