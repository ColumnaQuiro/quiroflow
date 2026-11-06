-- accept_invite failed with 42702 "column reference "account_id" is ambiguous"
-- (Sentry JAVASCRIPT-NUXT-P, production, 5 Nov 2026).
--
-- It is declared `returns table(account_id uuid)`, which makes account_id a
-- PL/pgSQL variable inside the body, and two statements compared a bare
-- account_id column against it:
--
--   * the account_roles lookup, taken when the invite carries no role_id;
--   * the appointments update, taken when the invite links imported
--     PracticeHub appointments (link_practitioner_name).
--
-- PL/pgSQL refuses to guess which one is meant, so on either path the invitee
-- could not join the clinic at all. Invites with a role and no linked name
-- never reach those statements, which is why it went unseen.
--
-- This is 20260925090000's text with those two columns qualified by their
-- table, and nothing else changed. The signature and return type are the same,
-- so `create or replace` keeps the existing grants and every caller
-- (pages/join.vue, middleware/account.global.ts) is unaffected.

create or replace function public.accept_invite(p_token text)
returns table(account_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite record;
  v_email text;
  v_team_member_id uuid;
  v_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from account_invites where token = p_token and accepted_at is null;
  if not found then
    raise exception 'Invalid or already-used invite link';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'You already belong to a practice';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  v_role_id := v_invite.role_id;
  if v_role_id is null then
    select account_roles.id into v_role_id from account_roles
      where account_roles.account_id = v_invite.account_id
        and account_roles.name = case v_invite.role when 'owner' then 'Owner' when 'front_desk' then 'Front Desk' else 'Practitioner' end;
  end if;

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
  values (
    v_invite.account_id, auth.uid(), coalesce(nullif(trim(v_invite.full_name), ''), v_email, 'Team member'),
    v_invite.role, v_role_id, false,
    -- Chosen on the invite itself now. The legacy rule stays for invites
    -- created before the column existed.
    coalesce(v_invite.is_practitioner, v_invite.role <> 'front_desk')
  )
  returning id into v_team_member_id;

  -- The clinics picked on the invite, or every active one when none were.
  -- An archived clinic is never assigned: it is a location that has closed.
  insert into team_member_clinics (team_member_id, clinic_id)
  select v_team_member_id, c.id from clinics c
  where c.account_id = v_invite.account_id
    and c.archived_at is null
    and (coalesce(cardinality(v_invite.clinic_ids), 0) = 0 or c.id = any(v_invite.clinic_ids));

  if v_invite.link_practitioner_name is not null then
    update appointments
      set practitioner_id = v_team_member_id
      where appointments.account_id = v_invite.account_id
        and appointments.practitioner_name = v_invite.link_practitioner_name
        and appointments.practitioner_id is null;
  end if;

  update account_invites set accepted_at = now() where id = v_invite.id;

  return query select v_invite.account_id;
end;
$function$;
