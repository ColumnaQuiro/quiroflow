-- The free trial is the whole product, practitioners and locations included.
--
-- Every new account trials on Solo (create_account_with_owner), which covers
-- one practitioner -- and the owner is created as a practitioner, so that seat
-- is taken on day one. The seat trigger (enforce_practitioner_seats) then
-- refused every colleague invited as a practitioner. Nothing warned the owner
-- when they sent the invite; the colleague found out when accepting it, either
-- as an error addressed to the owner on /join or, on the usual signup path,
-- not at all: the middleware discarded the failed invite and sent them to
-- onboarding to create a clinic of their own. A three-practitioner clinic
-- could not try QuiroFlow together without paying first. The location cap
-- did the same to a second clinic, which onboarding tells people "can come
-- later".
--
-- The trial already includes Growth (hasGrowthAddon treats 'trialing' as
-- having it), so this makes the rest of it consistent: no cap on seats or
-- locations while the account is on its free trial.
--
-- Only while it is still a trial with no Stripe subscription behind it. Once
-- a card is on file the trial carries into Stripe on a plan the owner chose,
-- and that plan's limits apply -- subscribe.post.ts has already refused any
-- plan that covers fewer practitioners than are active, so nobody reaches
-- that point over their allowance. The same refusal is what an owner meets
-- at the end of an open trial: pay for a plan that covers the team, or add
-- seats. Nothing grandfathered, nothing silently over.
--
-- Both functions are otherwise unchanged from 0150 and 0154.

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
    when s.status = 'trialing' and s.stripe_subscription_id is null then null
    when p.included_professionals is null then null
    else p.included_professionals + coalesce(s.extra_professionals, 0)
  end
  from subscriptions s join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;

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
    else p.included_clinics
  end
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;

revoke all on function public.clinic_location_allowance(uuid) from public;
grant execute on function public.clinic_location_allowance(uuid) to authenticated;
