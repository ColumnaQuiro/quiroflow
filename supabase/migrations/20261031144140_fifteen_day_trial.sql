-- Trials go 30 -> 15 days for every clinic that signs up from now on.
--
-- Only create_account_with_owner changes, and only the interval: it is the
-- one place a trial's length is decided (subscriptions.trial_ends_at, which
-- the banner, the subscription page and trial-expiry-cron all read). Trials
-- already running keep the end date they were promised.
--
-- CREATE OR REPLACE with the same six-argument signature, so the grants from
-- 20260924101011 and 20261018063146 stay as they are. The body is otherwise
-- unchanged from 20260924101011_ask_whether_the_owner_sees_patients.sql.

create or replace function public.create_account_with_owner(
  p_account_name text,
  p_clinic_name text,
  p_owner_name text default null::text,
  p_referred_by_slug text default null::text,
  p_default_phone_country text default 'ES',
  p_owner_is_practitioner boolean default true
)
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
  v_referred_by_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an account';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- A stale or malformed referral slug from the signup URL must not break
  -- account creation -- look it up and silently ignore if it doesn't
  -- resolve to a real account, rather than failing the whole signup.
  if p_referred_by_slug is not null then
    select id into v_referred_by_account_id from accounts where slug = p_referred_by_slug;
  end if;

  insert into accounts (name, slug, referred_by_account_id, default_phone_country)
    values (p_account_name, generate_unique_account_slug(p_account_name), v_referred_by_account_id,
            coalesce(nullif(upper(trim(p_default_phone_country)), ''), 'ES'))
    returning id into v_account_id;
  insert into clinics (account_id, name) values (v_account_id, p_clinic_name) returning id into v_clinic_id;
  insert into calendar_resources (account_id, clinic_id, name)
    values (v_account_id, v_clinic_id, 'Room 1');
  insert into subscriptions (account_id, plan_id, status, trial_ends_at)
    values (v_account_id, 'starter', 'trialing', now() + interval '15 days');

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, coalesce(p_owner_is_practitioner, true))
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;
