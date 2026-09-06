-- Reprices the three plans and, for the first time, makes the seat limits
-- mean something.
--
-- Background: the September pricing draft was competitor benchmarking with no
-- usage or cost data behind it. Measured against the one live account
-- (1,543 patients, 284 appointments/month, 3 practitioners, 393 outbound
-- WhatsApp messages/month, 6.86 GB of files) three things were wrong with it.
--
-- 1. Solo was overpriced at 69 EUR. Praxxos opens at 79 EUR but caps that tier
--    at 200 active patients, which no established clinic fits -- their real
--    entry price is 99-159 EUR. 59 EUR is a clean undercut that still reads as
--    a serious product.
--
-- 2. Clinic was "unlimited professionals" from 199 EUR. That inverted the
--    curve: a ten-practitioner group would pay under 20 EUR a head while a
--    four-person clinic on Pro plus one seat paid 36 EUR a head -- the larger,
--    heavier account paying less per practitioner than the smaller one. Clinic
--    now includes 6 practitioners and continues at 29 EUR, so that same group
--    pays 315 EUR.
--
-- 3. Seats were never enforced anywhere. included_professionals was read in
--    pages/subscription.vue to draw the plan card and nowhere else -- no check
--    stopped a Solo account adding a tenth practitioner. Enforcement lands in
--    this migration as a trigger, so it holds regardless of which client or
--    API route adds the row.
--
-- Only practitioners are billable. Front desk, practice managers and
-- bookkeepers are free and unlimited: charging per login pushes small clinics
-- onto one shared account, which destroys the audit trail, breaks
-- per-practitioner scheduling and makes the permission system pointless.
--
-- Stripe prices already existed for everything except Solo monthly, Solo
-- annual and the 29 EUR extra practitioner; those three were created in the
-- platform-billing sandbox account and are referenced below. Practice annual
-- deliberately stays at the existing 99 EUR rather than the 101 EUR the
-- proposal rounded to -- cheaper for the customer, already provisioned, and
-- still ~17% off monthly.

update plans set
  name = 'Solo',
  monthly_price_cents = 5900,
  annual_price_cents = 5000,
  included_professionals = 1,
  included_clinics = 1,
  extra_professional_price_cents = 2900,
  stripe_monthly_price_id = 'price_1UCcOvP9Wga5q4zRsjUFFMp8',
  stripe_annual_price_id = 'price_1UCcPKP9Wga5q4zRVX0t32L4',
  stripe_extra_professional_monthly_price_id = 'price_1UCcPiP9Wga5q4zRWufK2ezx',
  stripe_extra_professional_annual_price_id = 'price_1UBbNHP9Wga5q4zR73EmQYqo'
where id = 'starter';

update plans set
  name = 'Practice',
  monthly_price_cents = 11900,
  annual_price_cents = 9900,
  included_professionals = 3,
  included_clinics = 1,
  extra_professional_price_cents = 2900,
  stripe_extra_professional_monthly_price_id = 'price_1UCcPiP9Wga5q4zRWufK2ezx',
  stripe_extra_professional_annual_price_id = 'price_1UBbNHP9Wga5q4zR73EmQYqo'
where id = 'pro';

-- Clinic keeps its 199/169 pricing but stops being unlimited.
update plans set
  name = 'Clinic',
  included_professionals = 6,
  included_clinics = null,
  extra_professional_price_cents = 2900,
  stripe_extra_professional_monthly_price_id = 'price_1UCcPiP9Wga5q4zRWufK2ezx',
  stripe_extra_professional_annual_price_id = 'price_1UBbNHP9Wga5q4zR73EmQYqo'
where id = 'clinic';

-- Trials go 14 -> 30 days, matching PracticeHub. Switching means importing
-- years of patients, appointments, notes and files -- the migration runbook
-- alone is a ten-step sequence -- and a trial that expires mid-migration
-- converts nobody. Re-`create or replace`s the function 0134 last defined,
-- changing only the interval.
create or replace function public.create_account_with_owner(p_account_name text, p_clinic_name text, p_owner_name text default null::text)
returns table(account_id uuid, clinic_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_clinic_id uuid;
  v_team_member_id uuid;
  v_owner_role_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an account';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into accounts (name, slug)
    values (p_account_name, generate_unique_account_slug(p_account_name))
    returning id into v_account_id;
  insert into clinics (account_id, name) values (v_account_id, p_clinic_name) returning id into v_clinic_id;
  insert into calendar_resources (account_id, clinic_id, name)
    values (v_account_id, v_clinic_id, 'Room 1');
  insert into subscriptions (account_id, plan_id, status, trial_ends_at)
    values (v_account_id, 'starter', 'trialing', now() + interval '30 days');

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, true)
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;

-- How many practitioner seats an account is currently paying for. Null means
-- "no ceiling" -- an account with no subscription row at all, or a comped one,
-- is never blocked; enforcement is a billing rule, not a safety rail, and
-- locking a clinic out of its own staff list over it would be worse than the
-- unpaid seat.
create or replace function public.practitioner_seat_allowance(target_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when s.id is null then null
    when s.comped then null
    when p.included_professionals is null then null
    else p.included_professionals + coalesce(s.extra_professionals, 0)
  end
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;

revoke all on function public.practitioner_seat_allowance(uuid) from public;
grant execute on function public.practitioner_seat_allowance(uuid) to authenticated;

-- Blocks the seat-limit breach at the table rather than in one API route,
-- because practitioners get created and flipped from several places: the team
-- settings page writes team_members directly through PostgREST, invites go
-- through their own path, and the is_practitioner toggle is its own update.
-- A trigger is the only place that covers all of them.
--
-- Only fires when a row is actually becoming a billable practitioner --
-- turning someone into a practitioner, or restoring a soft-deleted one. Edits
-- to an existing practitioner, and anything to do with non-practitioner staff,
-- pass straight through.
create or replace function public.enforce_practitioner_seats()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowance integer;
  v_in_use integer;
begin
  if not new.is_practitioner or new.deleted_at is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.is_practitioner and old.deleted_at is null then
    return new;
  end if;

  v_allowance := practitioner_seat_allowance(new.account_id);
  if v_allowance is null then
    return new;
  end if;

  select count(*) into v_in_use
  from team_members
  where account_id = new.account_id
    and is_practitioner
    and deleted_at is null
    and id <> new.id;

  if v_in_use >= v_allowance then
    -- PT402 is PostgREST's escape hatch for choosing the HTTP status: a
    -- SQLSTATE of PTnnn returns nnn, so this surfaces as 402 Payment Required
    -- rather than a generic 400. It also keeps the seat limit distinguishable
    -- from a real check-constraint violation, which 23514 would not.
    raise exception using
      errcode = 'PT402',
      message = format(
        'Your plan covers %s practitioner(s) and all of them are in use. Add a seat on the Subscription page, or mark this person as non-practitioner staff -- admin users are free and unlimited.',
        v_allowance
      );
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_practitioner_seats on public.team_members;
create trigger enforce_practitioner_seats
  before insert or update on public.team_members
  for each row execute function public.enforce_practitioner_seats();
