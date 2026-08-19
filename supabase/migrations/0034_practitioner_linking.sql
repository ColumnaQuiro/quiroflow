-- Migrated appointments often only carry a free-text practitioner_name (no
-- real account exists yet). These columns let an invite remember which
-- name to retroactively link once someone actually accepts it, and what
-- their name should default to instead of their email.
alter table account_invites add column full_name text;
alter table account_invites add column link_practitioner_name text;

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

  insert into team_members (account_id, user_id, full_name, role)
  values (v_invite.account_id, auth.uid(), coalesce(nullif(trim(v_invite.full_name), ''), v_email, 'Team member'), v_invite.role)
  returning id into v_team_member_id;

  insert into team_member_clinics (team_member_id, clinic_id)
  select v_team_member_id, c.id from clinics c where c.account_id = v_invite.account_id;

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
