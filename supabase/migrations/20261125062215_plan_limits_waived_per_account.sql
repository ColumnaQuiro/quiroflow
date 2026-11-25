-- A plan's practitioner and location limits, waived for one account.
--
-- Clinic was unlimited on both from 17 Sep (20260917141806) until 19 Nov
-- (20261119131251), when it became 6 practitioners and 2 locations. A clinic
-- that was offered Clinic while it was still unlimited is owed that deal, at
-- the same 149 EUR -- and nothing could express it. The limits live only on
-- the shared `plans` row, so raising them there raises them for everyone,
-- and `comped` lifts them only by making the account free.
--
-- `limits_waived_on_plan` names the plan on which this account keeps no
-- practitioner or location limit. It applies only while the account is ON
-- that plan: an account grandfathered on Clinic that moves to Solo gets
-- Solo's one practitioner, not an unlimited Solo at 45 EUR. Moving back to
-- Clinic restores it, because the column is left as it was.
--
-- The price is untouched -- Stripe bills the plan's own price as for anyone
-- else on it. Only the two allowances below, and the matching checks in
-- subscribe.post.ts and utils/billing.ts planLimitsWaived, read the column.
--
-- Server-written only. `subscriptions` has a select policy for staff and no
-- other (0134), so a clinic cannot grant this to itself through PostgREST;
-- it is set by hand with the service role, and the platform-billing webhook
-- never writes it, so a Stripe event cannot clear it either.
--
-- Plain text, deliberately with no foreign key to plans. A second one
-- from subscriptions to plans makes every `plans(...)` embed on subscriptions
-- ambiguous -- pages/subscription.vue's, the account bootstrap's -- and
-- PostgREST refuses the whole select (PGRST201) rather than guess. A typo
-- here can only fail to match plan_id, which leaves the plan's own limits in
-- force: the safe direction.
--
-- No patient_id, no new table: nothing for merge_patients, anonymize_patient
-- or require_two_factor_on.

alter table public.subscriptions
  add column if not exists limits_waived_on_plan text;

comment on column public.subscriptions.limits_waived_on_plan is
  'Plan on which this account has no practitioner or location limit (grandfathered terms). Applies only while plan_id equals it. Set by hand with the service role.';

-- Both functions are 20260924100032 / 20261119131251 with one line added.
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
    when s.limits_waived_on_plan = s.plan_id then null
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
    when s.limits_waived_on_plan = s.plan_id then null
    when s.status = 'trialing' and s.stripe_subscription_id is null then null
    when p.included_clinics is null then null
    when p.extra_clinic_price_cents is null then p.included_clinics
    else p.included_clinics + coalesce(s.extra_clinics, 0)
  end
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.account_id = target_account_id;
$function$;
