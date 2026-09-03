-- Wires up the two missing pieces for platform billing enforcement:
-- 1. New signups now start a real trial instead of having no subscription
--    row at all.
-- 2. Every account that already existed before 0132 gets comped (free)
--    rather than being silently unbilled -- this is a policy call (comp
--    existing customers rather than starting their trial clock the moment
--    this ships), not something to infer from the schema.

-- Existing accounts predate `subscriptions` entirely, so none of them have a
-- row yet -- backfill one each, comped, so nothing about their access
-- changes. Moving any of them onto a real paid plan is a deliberate
-- admin-panel action from here on (quiroflow-admin's "Start subscription"),
-- not something this migration decides.
insert into subscriptions (account_id, plan_id, status, comped)
select id, 'starter', 'active', true
from accounts
where id not in (select account_id from subscriptions);

-- Staff can now read (never write -- that stays service_role-only, see
-- 0132's comment on why) their own account's subscription: the billing-lock
-- check in server/utils/requirePermission.ts and the account store both run
-- as the signed-in user, not service_role, so without this they'd see no
-- row at all and every account would look locked.
create policy "staff can view their account's subscription" on subscriptions
  for select using (is_account_member(account_id));

-- New signups get a real 14-day trial on Starter instead of no subscription
-- row at all (matches how PracticeHub/Cliniko/other chiropractic-software
-- competitors run their own trials: no plan picker at signup, trial starts
-- immediately, the real plan gets chosen once the trial ends and billing
-- starts). Re-`create or replace`s the same function 0127 last defined,
-- adding one insert.
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
    values (v_account_id, 'starter', 'trialing', now() + interval '14 days');

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, true)
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;
