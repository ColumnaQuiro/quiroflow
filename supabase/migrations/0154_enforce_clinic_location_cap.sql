-- Solo and Practice are priced against a single clinic location
-- (plans.included_clinics = 1, see 0150_pricing_solo_practice_clinic.sql),
-- and pages/subscription.vue already shows that number on the plan card --
-- but nothing ever stopped an account from adding a second location anyway.
-- included_professionals got a real trigger in 0150; included_clinics never
-- did. This closes that gap the same way: a DB trigger rather than a check
-- in pages/settings/clinics.vue, since that is the RLS-governed table every
-- client hits directly through PostgREST, and a client-side check is not
-- enforcement.

-- How many clinic locations an account's plan allows. Same null-means-
-- unlimited convention as practitioner_seat_allowance (0150): no
-- subscription row yet, a comped account, or a plan with no cap at all
-- (Clinic) all return null, and the trigger below treats null as "don't
-- block". There is no extra-location add-on to add on top of the base
-- allowance -- unlike seats, nothing in the pricing sells extra locations --
-- so this is just the plan's own included_clinics figure.
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
    else p.included_clinics
  end
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;

revoke all on function public.clinic_location_allowance(uuid) from public;
grant execute on function public.clinic_location_allowance(uuid) to authenticated;

-- Fires on every new clinic row. The account's very first clinic, created by
-- create_account_with_owner before the subscriptions row exists yet, is
-- naturally exempt: clinic_location_allowance returns null (no subscription
-- found) for it, same as practitioner_seat_allowance does for the account's
-- first team member.
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
  v_allowance := clinic_location_allowance(new.account_id);
  if v_allowance is null then
    return new;
  end if;

  select count(*) into v_in_use from clinics where account_id = new.account_id;

  if v_in_use >= v_allowance then
    -- PT402 -> HTTP 402, same convention as enforce_practitioner_seats
    -- (0150) -- lets the client tell a plan limit apart from a plain
    -- validation error (23514/400).
    raise exception using
      errcode = 'PT402',
      message = format(
        'Your plan covers %s clinic location(s) and all of them are in use. Upgrade your plan to add another location.',
        v_allowance
      );
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_clinic_location_cap on public.clinics;
create trigger enforce_clinic_location_cap
  before insert on public.clinics
  for each row execute function public.enforce_clinic_location_cap();
