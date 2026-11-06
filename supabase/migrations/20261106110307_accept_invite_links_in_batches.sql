-- Accepting an invite that carries imported appointments did an unbounded
-- amount of work inside the join, and if that ever ran out of time nobody
-- joined.
--
-- An invite made from Settings -> Team -> imported names says "gets the
-- imported appointments of <name>" (account_invites.link_practitioner_name),
-- and accept_invite linked them in one statement:
--
--   update appointments set practitioner_id = <new member>
--    where practitioner_name = <name> and practitioner_id is null
--
-- The RPC is called by `authenticated`, whose statement_timeout is 8 s, and
-- that timeout covers the whole call. Being security definer it skips RLS, which
-- is what made the same link time out on Settings -> Team: there it runs as
-- the signed-in user, and the appointments policies are evaluated per row.
-- Measured on production as postgres, triggers included, the largest name we
-- have (8,143 appointments) links in about 1.1 s -- so the join is not failing
-- today. But the cost grows with the name's history and has no ceiling, and
-- when it does run out the timeout rolls back the whole RPC, team member
-- included: the invitee cannot join at all, and every retry fails the same way.
--
-- Now accept_invite links only the first batch (the most recent 2,000) and
-- records which team member accepted the invite. The rest is linked by
-- link_my_invited_appointments(), which the app calls in a loop straight after
-- accepting; each call is its own statement with a bounded batch, also security
-- definer (no RLS cost), and commits on its own, so a stop part-way keeps what
-- was done. Whatever is left (the tab was closed mid-way) still shows under
-- Settings -> Team -> imported names, where an admin can link it.
--
-- Backwards-compatible with the code that is live until the next release: it
-- calls accept_invite exactly as before (same signature and return type, so
-- `create or replace` keeps the grants) and does not know about the new RPC.
-- An invite accepted in that window joins and gets its 2,000 most recent
-- appointments; any remainder is listed under imported names, as above.
--
-- accept_invite below is 20261106063930's text with only the link changed.

-- A plain uuid, not a foreign key. It is only ever looked up by the caller's
-- own team member id, so a dangling one (the member deleted) matches nobody.
-- A foreign key to team_members would add a relationship PostgREST considers
-- for embeds, and check:migration-compatibility flags every team_members(...)
-- embed in the app as possibly ambiguous -- not worth it for a lookup key.
alter table public.account_invites
  add column accepted_team_member_id uuid;

comment on column public.account_invites.accepted_team_member_id is
  'The team member this invite created when it was accepted. link_my_invited_appointments() finds the imported name to link through it.';

-- The batches below, the imported-names list on Settings -> Team and its Link
-- all read exactly this: an account's appointments under a name with no
-- practitioner. Without it each batch re-scans the account's appointments.
create index if not exists appointments_unlinked_practitioner_name_idx
  on public.appointments (account_id, practitioner_name)
  where practitioner_id is null and practitioner_name is not null;

-- One batch: up to p_limit of the account's appointments under p_name that have
-- no practitioner yet, most recent first, become p_team_member_id's. Returns
-- how many moved. Internal: callable only from the definer functions below.
create or replace function public.link_imported_appointments_batch(
  p_account_id uuid,
  p_name text,
  p_team_member_id uuid,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_linked integer;
begin
  with batch as (
    select a.id
    from appointments a
    where a.account_id = p_account_id
      and a.practitioner_name = p_name
      and a.practitioner_id is null
    order by a.starts_at desc, a.id
    limit greatest(coalesce(p_limit, 0), 0)
    -- Two loops at once (two tabs) take different rows instead of waiting on
    -- each other's.
    for update skip locked
  )
  update appointments a
    set practitioner_id = p_team_member_id
    from batch
    where a.id = batch.id;
  get diagnostics v_linked = row_count;
  return v_linked;
end;
$function$;

revoke all on function public.link_imported_appointments_batch(uuid, text, uuid, integer) from public;
revoke all on function public.link_imported_appointments_batch(uuid, text, uuid, integer) from anon;
revoke all on function public.link_imported_appointments_batch(uuid, text, uuid, integer) from authenticated;

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

  -- Only the first batch here: all of them in this statement has no ceiling,
  -- and running out of time would take the whole join down with it. The app
  -- links the rest with link_my_invited_appointments().
  if v_invite.link_practitioner_name is not null then
    perform link_imported_appointments_batch(v_invite.account_id, v_invite.link_practitioner_name, v_team_member_id, 2000);
  end if;

  update account_invites
    set accepted_at = now(), accepted_team_member_id = v_team_member_id
    where id = v_invite.id;

  return query select v_invite.account_id;
end;
$function$;

-- The caller's next batch of the imported appointments their invite promised
-- them: {"linked": moved by this call, "remaining": still unlinked under that
-- name}. Called in a loop until nothing is left or nothing moves. It only ever
-- acts on the invite the caller accepted, and returns no clinic data beyond
-- those two counts. No two-factor check, deliberately: an account that
-- requires it sends a new member to set it up right after joining, and the
-- link has to run either way.
create or replace function public.link_my_invited_appointments(p_limit integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
  v_account_id uuid;
  v_name text;
  v_linked integer;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select tm.id, tm.account_id into v_member_id, v_account_id
  from team_members tm
  where tm.user_id = auth.uid()
  limit 1;

  if v_member_id is not null then
    select ai.link_practitioner_name into v_name
    from account_invites ai
    where ai.accepted_team_member_id = v_member_id
      and ai.account_id = v_account_id
      and ai.link_practitioner_name is not null
    order by ai.accepted_at desc
    limit 1;
  end if;

  if v_name is null then
    return jsonb_build_object('linked', 0, 'remaining', 0);
  end if;

  -- 5,000 at most per call: about 0.7 s at the rate measured on production
  -- without RLS, so one call stays far inside the 8 s timeout.
  v_linked := link_imported_appointments_batch(v_account_id, v_name, v_member_id, least(greatest(coalesce(p_limit, 2000), 1), 5000));

  select count(*) into v_remaining
  from appointments a
  where a.account_id = v_account_id
    and a.practitioner_name = v_name
    and a.practitioner_id is null;

  return jsonb_build_object('linked', v_linked, 'remaining', v_remaining);
end;
$function$;

revoke all on function public.link_my_invited_appointments(integer) from public;
revoke all on function public.link_my_invited_appointments(integer) from anon;
grant execute on function public.link_my_invited_appointments(integer) to authenticated;
