-- Put the clinic location cap in production, where it never arrived.
--
-- 0154_enforce_clinic_location_cap.sql added the trigger that stops a plan
-- going over plans.included_clinics. Every database built from the repo has
-- it -- CI, local -- and production does not: neither the trigger nor its
-- functions existed there on 24 Sep 2026. 0154 is one of the hand-numbered
-- migrations that were applied by hand, if at all, and the automated apply
-- (scripts/apply-migrations.mjs) only picks up timestamped files, so it was
-- never going to be caught up. A paying Solo clinic in production could add
-- any number of locations while the Subscription page said "1 of 1".
--
-- Applying it cannot break anyone: the trigger fires only on a new clinic,
-- and on the day this was written every production account had exactly one.
--
-- Only the trigger and its function are here. clinic_location_allowance()
-- comes from 20260924100032, which runs before this and adds the free-trial
-- exemption; repeating 0154's own version of it here would put the cap back
-- on every trial. Everything below is 0154's text, unchanged, and harmless
-- to re-run where 0154 already applied.

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

-- A trigger function is not something a client should call directly; the
-- same revoke 20260923094500 applies to enforce_practitioner_seats.
revoke execute on function public.enforce_clinic_location_cap() from public, anon, authenticated;

drop trigger if exists enforce_clinic_location_cap on public.clinics;
create trigger enforce_clinic_location_cap
  before insert on public.clinics
  for each row execute function public.enforce_clinic_location_cap();
