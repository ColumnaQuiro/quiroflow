-- Two-factor login: an authenticator-app code (TOTP) on top of the password,
-- the way PracticeHub does it -- each person sets it up on their own login,
-- and from then on every sign-in asks for the six-digit code. On top of that,
-- a clinic can REQUIRE it of its whole team (accounts.require_two_factor).
--
-- The code itself is Supabase Auth's own MFA: enrolling, challenging and
-- verifying happen in GoTrue, and a verified session carries `aal: aal2` in
-- its JWT. What this migration adds is the part GoTrue cannot know about --
-- that a password-only (aal1) session must not be able to read the clinic's
-- data when two-factor applies to that person.
--
-- That has to be enforced here and not only by the app's redirect. A redirect
-- stops someone who uses the app; a stolen password used against PostgREST
-- directly never sees it. So every table carries a RESTRICTIVE policy that
-- is ANDed with whatever permissive policies it already has.

alter table public.accounts
  add column if not exists require_two_factor boolean not null default false;

comment on column public.accounts.require_two_factor is
  'When true, every team member must sign in with an authenticator-app code. Guarded by accounts_guard_require_two_factor.';

-- True when this session is allowed through. Two-factor applies to a person
-- when they have set it up themselves (a verified factor), or when any clinic
-- they are an active member of requires it. Only then is aal2 needed.
--
-- auth.uid() is null for anon and for service-role / SQL-console access --
-- nothing to check, and the restrictive policies below are scoped to
-- `authenticated` anyway.
--
-- Patients signing in to the portal or the app have no team_members row and
-- no factor, so this is true for them and nothing about their access changes.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not (
        exists (
          select 1 from auth.mfa_factors f
          where f.user_id = auth.uid() and f.status = 'verified'
        )
        or exists (
          select 1
          from public.team_members tm
          join public.accounts a on a.id = tm.account_id
          where tm.user_id = auth.uid()
            and tm.deleted_at is null
            and a.require_two_factor
        )
      );
$$;

revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

-- What the app should do with this session: 'ok', 'verify' (has a factor,
-- has not entered the code yet) or 'enroll' (their clinic requires two-factor
-- and they have not set it up). The app asks this BEFORE it reads anything
-- else, because every other read would come back empty -- and an empty
-- team_members read is what sends a person to onboarding to create a new
-- clinic, or makes the mobile app try to claim them as a patient.
create or replace function public.get_my_two_factor_gate()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.mfa_satisfied() then 'ok'
    when exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    ) then 'verify'
    else 'enroll'
  end;
$$;

revoke all on function public.get_my_two_factor_gate() from public, anon;
grant execute on function public.get_my_two_factor_gate() to authenticated;

-- The policy every table gets. A function rather than a copied statement so
-- a migration that creates a table can say `select
-- public.require_two_factor_on('public.new_table')` and be done -- and so
-- scripts/check-rls-two-factor.mjs has one thing to look for.
--
-- `(select public.mfa_satisfied())` rather than the bare call: wrapped, the
-- planner evaluates it once per query as an InitPlan instead of once per row
-- (see scripts/check-rls-initplan.mjs).
create or replace function public.require_two_factor_on(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create policy "two factor when required" on %s as restrictive for all to authenticated '
    'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
    target
  );
end;
$$;

revoke all on function public.require_two_factor_on(regclass) from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    perform public.require_two_factor_on(t.tbl);
  end loop;
end;
$$;

-- Patient files, photos and documents live in storage, and their policies
-- call is_account_member like the tables do.
select public.require_two_factor_on('storage.objects');

-- Who can switch the requirement, and when.
--
-- accounts' own update policy is any member of the clinic -- right for the
-- rest of the row, not for this. Turning two-factor off for everyone is a
-- security decision, so it takes the same permissions as the Team Members
-- page it lives on.
--
-- Turning it ON also needs an aal2 session: the person switching it on must
-- already sign in with a code. Otherwise the very next page load sends them
-- to set it up, which is a confusing way to find out what the switch did.
create or replace function public.accounts_guard_require_two_factor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.require_two_factor is not distinct from old.require_two_factor then
    return new;
  end if;

  -- Service role and the SQL console have no auth.uid(): support switching it
  -- off for a clinic that has locked itself out is exactly this path.
  if auth.uid() is null then
    return new;
  end if;

  if not (public.has_permission(new.id, 'settings_access') and public.has_permission(new.id, 'team_admin')) then
    raise exception 'Only a team admin can change the two-factor requirement'
      using errcode = '42501';
  end if;

  if new.require_two_factor and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Turn on two-factor authentication for your own login before requiring it for the team'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_guard_require_two_factor on public.accounts;
create trigger accounts_guard_require_two_factor
  before update of require_two_factor on public.accounts
  for each row execute function public.accounts_guard_require_two_factor();

-- Which of a clinic's team members have two-factor set up, for the Team
-- Members page. auth.mfa_factors is not readable from the client, so this is
-- the only way the page can show it. Security definer bypasses the
-- restrictive policies above, so it checks mfa_satisfied() itself.
create or replace function public.team_two_factor_status(p_account_id uuid)
returns table (team_member_id uuid, enrolled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id,
         exists (
           select 1 from auth.mfa_factors f
           where f.user_id = tm.user_id and f.status = 'verified'
         )
  from public.team_members tm
  where tm.account_id = p_account_id
    and tm.deleted_at is null
    and public.is_account_member(p_account_id)
    and public.mfa_satisfied();
$$;

revoke all on function public.team_two_factor_status(uuid) from public, anon;
grant execute on function public.team_two_factor_status(uuid) to authenticated;

-- get_my_bootstrap is security definer too, so it would hand an aal1 session
-- the clinic's name, locations and the person's permissions regardless of
-- the policies above. `me` now comes back empty until two-factor is
-- satisfied, and the account object carries require_two_factor so Account
-- Settings knows whether "Remove" is allowed.
--
-- Body otherwise identical to 20260923163951_bootstrap_trial_card_on_file.sql.
create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
      and public.mfa_satisfied()
    limit 1
  )
  select case
    when not exists (select 1 from me) then jsonb_build_object('team_member', null)
    else (
      select jsonb_build_object(
        'team_member', to_jsonb(me.*),
        'account', (
          select to_jsonb(a) from (
            select name, slug, whatsapp_confirmation_template_name,
                   whatsapp_recall_template_name, scheduling_policy_fee_cents,
                   default_phone_country, require_two_factor
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at, growth_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;
