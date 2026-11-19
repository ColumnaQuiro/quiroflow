-- Clinic stops being unlimited: 6 practitioners and 2 locations included,
-- 19 EUR for each practitioner beyond that and 29 EUR for each location.
--
-- It has been unlimited on both since 17 Sep (20260917141806), to answer
-- QuiroHiro Plus at 97 EUR with unlimited users. That left one flat 149 EUR
-- for a group of any size, so a three-site, fifteen-practitioner group paid
-- less per head than a four-person clinic on Practice. The figures:
--
--   Practitioners. Six is where Practice already lands with two extra seats
--   (99 + 2 x 19 = 137), so Clinic costs 12 EUR more than Practice for the
--   same team at every size -- and those 12 EUR buy the second location and
--   the API. Nine included would have made Clinic the cheaper plan from the
--   seventh practitioner, at 16.6 EUR a head against a 19 EUR seat.
--
--   Locations. A third site with three practitioners adds 29 + 57 = 86 EUR,
--   under the 99 EUR a second Practice account would cost, so one account
--   stays the cheaper way to run a group.
--
-- The practitioner allowance is per ACCOUNT, as it always has been: six to
-- spread across the locations however the clinic likes, not three per site.
--
-- Nobody is on Clinic when this is written -- every paying or trialing row is
-- on Solo -- so no account lands over a limit it did not agree to. Comped
-- accounts and open trials stay uncapped (20260924100032).
--
-- Extra locations are new. Seats could already be bought
-- (subscriptions.extra_professionals); locations could not, because the only
-- plan with more than one had no limit to raise. `extra_clinics` is their
-- count, written by the platform-billing webhook from the Stripe item's
-- quantity like every other bought thing on the row. A plan sells them only
-- when it has a price for one, which today is Clinic alone: a second
-- location on Solo or Practice is still a change of plan.
--
-- Like the seat, the location carries no annual discount: one
-- extra_clinic_price_cents is what the Subscription page shows for both
-- intervals, so both Stripe prices bill 29 EUR a month (348 a year). See
-- subscribe.post.ts for why the seat went the same way.
--
-- The prices are in the live platform-billing account (acct_1UD1lr0Ov3CXtGBc),
-- product `extra-clinic`.

alter table public.plans
  add column extra_clinic_price_cents integer,
  add column stripe_extra_clinic_monthly_price_id text,
  add column stripe_extra_clinic_annual_price_id text;

alter table public.subscriptions
  add column extra_clinics integer not null default 0
  constraint subscriptions_extra_clinics_not_negative check (extra_clinics >= 0);

update public.plans set
  included_professionals = 6,
  included_clinics = 2,
  extra_clinic_price_cents = 2900,
  stripe_extra_clinic_monthly_price_id = 'price_1UdV8Y0Ov3CXtGBc3DdQZGBE',
  stripe_extra_clinic_annual_price_id = 'price_1UdV8h0Ov3CXtGBcnHl5SWyx'
where id = 'clinic';

-- Bought locations count only on a plan that sells them. A row that moved
-- from Clinic to a smaller plan has its extra_clinics reset by the webhook
-- (the item is gone), but the allowance does not depend on that having
-- happened yet.
create or replace function public.clinic_location_allowance(target_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when s.id is null then null
    when s.comped then null
    when s.status = 'trialing' and s.stripe_subscription_id is null then null
    when p.included_clinics is null then null
    when p.extra_clinic_price_cents is null then p.included_clinics
    else p.included_clinics + coalesce(s.extra_clinics, 0)
  end
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;

revoke all on function public.clinic_location_allowance(uuid) from public;
grant execute on function public.clinic_location_allowance(uuid) to authenticated;

-- Only the message changes: "upgrade your plan" was the whole answer while
-- the top plan had no limit, and is the wrong one for a clinic already on it.
create or replace function public.enforce_clinic_location_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowance integer;
  v_in_use integer;
begin
  -- An update only matters when it brings an archived clinic back.
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;
  end if;
  -- Inserting one already archived takes no place.
  if tg_op = 'INSERT' and new.archived_at is not null then
    return new;
  end if;

  v_allowance := clinic_location_allowance(new.account_id);
  if v_allowance is null then
    return new;
  end if;

  select count(*) into v_in_use
  from clinics
  where account_id = new.account_id and archived_at is null and id <> new.id;

  if v_in_use >= v_allowance then
    -- PT402 -> HTTP 402, same convention as enforce_practitioner_seats
    -- (0150) -- lets the client tell a plan limit apart from a plain
    -- validation error (23514/400).
    raise exception using
      errcode = 'PT402',
      message = format(
        'Your plan covers %s clinic location(s) and all of them are in use. Add a location or change plan on the Subscription page.',
        v_allowance
      );
  end if;

  return new;
end;
$function$;
