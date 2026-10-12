-- What the AI receptionist changes on its own -- the visits it books and
-- moves, the patient records it makes from leads -- in the audit trail under
-- its own name, so that anything it got wrong can be found and put right.
--
-- Its writes are service-role requests carrying `x-audit-actor: receptionist`
-- (server/utils/receptionistAudit.ts). audit_actor already believes that
-- header only from a service_role request, which a browser cannot make; it
-- now also takes the literal 'receptionist' as an actor of its own, where it
-- used to read only a team member's id and fall back to 'server' -- under
-- which these changes would have been indistinguishable from an import or a
-- cron. The rest of the function is unchanged.

alter table public.audit_logs drop constraint audit_logs_actor_check;
alter table public.audit_logs add constraint audit_logs_actor_check
  check (actor in ('staff', 'patient', 'user', 'public', 'server', 'system', 'receptionist'));

create or replace function public.audit_actor(p_account_id uuid, out team_member_id uuid, out actor text, out actor_detail text, out actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_role text;
  v_header text;
  v_uid uuid := auth.uid();
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_role := coalesce(v_claims ->> 'role', '');

  if v_uid is not null then
    select tm.id, tm.full_name into team_member_id, actor_name
    from public.team_members tm
    where tm.account_id = p_account_id and tm.user_id = v_uid;
    if team_member_id is not null then
      actor := 'staff';
    elsif exists (select 1 from public.patients p where p.account_id = p_account_id and p.user_id = v_uid) then
      actor := 'patient';
    else
      -- Signed in, but neither staff nor a patient here yet: someone creating
      -- their clinic, before their own team_members row exists.
      actor := 'user';
      select u.email into actor_detail from auth.users u where u.id = v_uid;
    end if;
    return;
  end if;

  if v_role = 'service_role' then
    begin
      v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-actor';
    exception when others then
      v_header := null;
    end;
    -- The AI receptionist booking or moving a visit on its own
    -- (server/utils/receptionistBooking.ts): named as itself, so what it
    -- changed can be found and put right.
    if v_header = 'receptionist' then
      actor := 'receptionist';
      actor_name := 'Recepcionista IA';
      return;
    end if;
    if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select tm.id, tm.full_name into team_member_id, actor_name
      from public.team_members tm
      where tm.id = v_header::uuid and tm.account_id = p_account_id;
    end if;
    actor := case when team_member_id is not null then 'staff' else 'server' end;
    return;
  end if;

  if v_role = 'anon' then
    actor := 'public';
    return;
  end if;

  actor := 'system';
  actor_detail := session_user::text;
end;
$$;
revoke all on function public.audit_actor(uuid) from public, anon, authenticated;
