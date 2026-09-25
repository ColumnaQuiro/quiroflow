-- Settings -> Team, rebuilt (Practitioners merged into it).
--
-- An invite now carries two choices that used to be guessed from the role:
--
-- 1. is_practitioner. accept_invite made everyone a practitioner unless their
--    legacy role was 'front_desk', and the page mapped every role that was not
--    Front Desk -- custom roles and Owner included -- to 'practitioner'. So
--    inviting a "Gerencia" or an Owner quietly created a practitioner, who
--    took a paid seat and could be refused at acceptance by the seat cap. The
--    person inviting now says whether they will see patients. Null (invites
--    made before this) keeps the old rule.
--
-- 2. clinic_ids. accept_invite assigned every clinic that existed, archived
--    ones included. The invite can now name the clinics; empty or null means
--    every active one, as before minus the archived.
--
-- 3. last_sent_at, so the pending list can say when the email last went out
--    and "Reenviar email" has something to update.
--
-- accept_invite below is 0127's text with only those two changes.

alter table public.account_invites add column is_practitioner boolean;
alter table public.account_invites add column clinic_ids uuid[];
alter table public.account_invites add column last_sent_at timestamptz;

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
    select id into v_role_id from account_roles
      where account_id = v_invite.account_id
        and name = case v_invite.role when 'owner' then 'Owner' when 'front_desk' then 'Front Desk' else 'Practitioner' end;
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
      where account_id = v_invite.account_id
        and practitioner_name = v_invite.link_practitioner_name
        and practitioner_id is null;
  end if;

  update account_invites set accepted_at = now() where id = v_invite.id;

  return query select v_invite.account_id;
end;
$function$;
