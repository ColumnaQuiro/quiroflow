-- Lets an account owner invite a new team member without needing a
-- service-role key: generate a token, share the /join?token=... link,
-- and accept_invite() adds the invited (already-authenticated) user to
-- the account as a team member once they sign up/sign in.

create table account_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  email text,
  role text not null default 'practitioner' check (role in ('owner', 'practitioner', 'front_desk')),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table account_invites enable row level security;

create policy "staff manage account_invites" on account_invites
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create or replace function accept_invite(p_token text)
returns table (account_id uuid)
language plpgsql
security definer
set search_path = public
as $$
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
  values (v_invite.account_id, auth.uid(), coalesce(v_email, 'Team member'), v_invite.role)
  returning id into v_team_member_id;

  insert into team_member_clinics (team_member_id, clinic_id)
  select v_team_member_id, c.id from clinics c where c.account_id = v_invite.account_id;

  update account_invites set accepted_at = now() where id = v_invite.id;

  return query select v_invite.account_id;
end;
$$;

revoke execute on function accept_invite(text) from public;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated;
