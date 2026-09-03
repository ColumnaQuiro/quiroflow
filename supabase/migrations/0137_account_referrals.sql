-- Referral tracking for the sidebar's "Refer Your Friends!" link: each
-- account can record which existing account referred it, mirroring
-- PracticeHub's referral link (a signup URL tagged with the referring
-- clinic's own code/slug).
alter table accounts add column referred_by_account_id uuid references accounts(id) on delete set null;

drop function if exists public.create_account_with_owner(text, text, text);

create function public.create_account_with_owner(
  p_account_name text,
  p_clinic_name text,
  p_owner_name text default null::text,
  p_referred_by_slug text default null::text
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

  insert into accounts (name, slug, referred_by_account_id)
    values (p_account_name, generate_unique_account_slug(p_account_name), v_referred_by_account_id)
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

revoke execute on function public.create_account_with_owner(text, text, text, text) from public;
revoke execute on function public.create_account_with_owner(text, text, text, text) from anon;
grant execute on function public.create_account_with_owner(text, text, text, text) to authenticated;
