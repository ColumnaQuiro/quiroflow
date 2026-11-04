-- Onboarding asks for two things it did not before.
--
-- 1. clinics.country. QuiroFlow will have clinics outside Spain, and nothing
--    recorded which country a location is in: the closest thing was
--    accounts.default_phone_country, which is a guess about patients' phone
--    numbers rather than a fact about the clinic. Every existing clinic is
--    Spanish, so the default fills them in. Onboarding now asks for the
--    country instead of the dial code, and sets the account's default dial
--    code from it; Settings -> Messages still changes that on its own.
--
-- 2. accounts.owner_phone. A number to reach whoever signed the clinic up,
--    for QuiroFlow's own use (the new-account email carries it). On accounts
--    rather than team_members on purpose: guard_team_member_write lists the
--    personal columns another member may not touch, and a column it does not
--    list is writable by any colleague. accounts_guard_settings works the
--    other way round -- a column accounts_settings_permission() does not list
--    needs an owner -- which is exactly who should be changing this.
--
-- create_account_with_owner takes both. It is dropped and re-created rather
-- than replaced, because two more arguments make a different signature, and
-- CREATE OR REPLACE would leave the six-argument version beside it: a call
-- naming only the old six arguments would then match both and fail as
-- ambiguous. The new arguments default to null, so the live onboarding page,
-- which still sends six, keeps working against this. The body is otherwise
-- unchanged from 20261031144140_fifteen_day_trial.sql.

alter table public.clinics add column country text not null default 'ES';
alter table public.clinics
  add constraint clinics_country_format check (country ~ '^[A-Z]{2}$');

alter table public.accounts add column owner_phone text;

drop function public.create_account_with_owner(text, text, text, text, text, boolean);

create function public.create_account_with_owner(
  p_account_name text,
  p_clinic_name text,
  p_owner_name text default null::text,
  p_referred_by_slug text default null::text,
  p_default_phone_country text default 'ES',
  p_owner_is_practitioner boolean default true,
  p_clinic_country text default null::text,
  p_owner_phone text default null::text
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
  v_phone_country text := coalesce(nullif(upper(trim(p_default_phone_country)), ''), 'ES');
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

  insert into accounts (name, slug, referred_by_account_id, default_phone_country, owner_phone)
    values (p_account_name, generate_unique_account_slug(p_account_name), v_referred_by_account_id,
            v_phone_country, nullif(trim(p_owner_phone), ''))
    returning id into v_account_id;
  -- An older caller sends no country: the dial code it did send is the best
  -- guess at one.
  insert into clinics (account_id, name, country)
    values (v_account_id, p_clinic_name, coalesce(nullif(upper(trim(p_clinic_country)), ''), v_phone_country))
    returning id into v_clinic_id;
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

-- The grants the old signature had (20260924101011, 20261018063146) went with it.
revoke execute on function public.create_account_with_owner(text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.create_account_with_owner(text, text, text, text, text, boolean, text, text) to authenticated, service_role;
