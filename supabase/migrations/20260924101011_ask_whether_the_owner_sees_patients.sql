-- Ask the owner whether they see patients, instead of assuming they do.
--
-- create_account_with_owner made every owner a practitioner. For most
-- clinics signing up that is right -- a chiropractor who owns the practice --
-- and it is what puts them in the calendar and on the booking page from the
-- first minute. For a practice run by a manager it was wrong in two ways: a
-- calendar column and a bookable slot for someone who treats nobody, and the
-- plan's one included seat spent on them, so the first real practitioner
-- they invited was refused.
--
-- Onboarding now asks ("Do you see patients yourself?", yes by default) and
-- passes the answer here. The default keeps the old behaviour for any caller
-- that does not send it -- the code already live calls this with five named
-- arguments and goes on working unchanged.
--
-- Dropped and re-created rather than replaced: a new argument is a new
-- signature, and CREATE OR REPLACE would leave the five-argument version
-- beside it. With both present, a call naming the five arguments matches
-- both -- the new one through its default -- and Postgres refuses it as
-- ambiguous, which would break every signup until the next release.
--
-- The rest of the function is unchanged from
-- 20260914095551_account_default_phone_country.sql.

drop function public.create_account_with_owner(text, text, text, text, text);

-- The two-argument version from 0002, last re-created in 0127, goes too.
-- Nothing calls it: onboarding and the test seeding both name p_owner_name,
-- which it does not have, so every call already resolves to the full
-- version. Left in place it is not merely dead -- beside a version whose
-- extra arguments all have defaults, a call naming only the account and
-- clinic would match both and be refused as ambiguous.
drop function if exists public.create_account_with_owner(text, text);

create function public.create_account_with_owner(
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
    values (v_account_id, 'starter', 'trialing', now() + interval '30 days');

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, coalesce(p_owner_is_practitioner, true))
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;

revoke all on function public.create_account_with_owner(text, text, text, text, text, boolean) from public;
grant execute on function public.create_account_with_owner(text, text, text, text, text, boolean) to authenticated;
