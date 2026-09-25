-- Any team member could rewrite any team_members row.
--
-- The only policy on the table was 0001's
--   "staff manage team_members" FOR ALL using is_account_member(account_id)
-- and nothing narrowed it later: no column grants, no guard trigger. So a
-- Front Desk login could PATCH /rest/v1/team_members straight through
-- PostgREST and give itself the Owner role (role_id), make itself an owner
-- outright (is_owner), deactivate a colleague (deleted_at), or change anyone's
-- is_practitioner / online_booking_enabled / business_hours / name. team_admin
-- only ever hid the Team page; it never stopped the write. team_member_clinics
-- had the same FOR ALL policy.
--
-- What each caller is allowed now:
--
--   * Your OWN row, personal columns: full_name, color, photo_storage_path,
--     theme_preference, language_preference, dashboard_layout. That is
--     everything Account Settings, the theme toggle, the dashboard editor,
--     onboarding and the mobile profile photo write about their own person.
--   * Everything else, on anyone's row -- role, role_id, is_practitioner,
--     online_booking_enabled, business_hours, deleted_at, and the personal
--     columns of OTHER members -- needs team_admin (owners pass
--     has_permission already). That is what Settings -> Team writes.
--   * Your own role_id: owners only. A team admin choosing their own role
--     could pick one with billing or developer access they were never given.
--   * is_owner: owners only, never team_admin alone; and never so that the
--     account is left with no active owner. Deactivating an owner or deleting
--     their row counts as losing one.
--   * id, account_id, user_id, created_at: nobody. No caller changes them,
--     and moving a row to another account or another login is the whole
--     attack in a different shape.
--   * INSERT / DELETE of team_members, and every write to
--     team_member_clinics: team_admin (and an insert never as an owner). No client does any of these today --
--     joining an account goes through accept_invite / create_account_with_owner,
--     which are security definer, owned by postgres and so bypass RLS.
--
-- Skipped when there is no auth.uid(): the service role (account deletion
-- deactivating the caller's row, support recovering a locked-out clinic) and
-- cascades from auth.users / accounts. The definer RPCs above do have an
-- auth.uid() but only INSERT, which this trigger does not cover.
--
-- One cascade does arrive with a user attached: deleting a role from
-- Settings -> Roles (roles_admin) sets role_id to null on whoever held it,
-- via the FK's ON DELETE SET NULL. That is allowed when the old role no
-- longer exists, so a roles admin who is not a team admin can still delete
-- a role.

-- ------------------------------------------------------------ team_members
drop policy if exists "staff manage team_members" on public.team_members;

create policy "staff view team_members" on public.team_members
  for select using (is_account_member(account_id));

-- Column-level rules for UPDATE are the trigger below; the policy only keeps
-- the row inside an account the caller belongs to.
create policy "staff update team_members" on public.team_members
  for update using (is_account_member(account_id)) with check (is_account_member(account_id));

-- Never straight in as an owner: that is an UPDATE of is_owner afterwards,
-- which the trigger reserves for owners. (Checking "is the caller an owner"
-- here would read team_members from its own policy and recurse.)
create policy "team admins insert team_members" on public.team_members
  for insert with check (
    is_account_member(account_id) and has_permission(account_id, 'team_admin') and not is_owner
  );

create policy "team admins delete team_members" on public.team_members
  for delete using (is_account_member(account_id) and has_permission(account_id, 'team_admin'));

create or replace function public.guard_team_member_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean;
  v_caller_is_owner boolean;
  v_role_cascade boolean;
  v_loses_owner boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_caller_is_owner := exists (
    select 1 from team_members me
    where me.account_id = old.account_id and me.user_id = auth.uid()
      and me.is_owner and me.deleted_at is null
  );

  if tg_op = 'DELETE' then
    if old.is_owner and old.deleted_at is null then
      -- The account itself is going: nothing is left to be without an owner.
      if not exists (select 1 from accounts where id = old.account_id) then
        return old;
      end if;
      if not v_caller_is_owner then
        raise exception 'Only an owner can remove an owner' using errcode = '42501';
      end if;
      perform 1 from accounts where id = old.account_id for update;
      if not exists (
        select 1 from team_members o
        where o.account_id = old.account_id and o.id <> old.id and o.is_owner and o.deleted_at is null
      ) then
        raise exception 'An account needs at least one owner. Make someone else an owner first.' using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  if (new.id, new.account_id, new.user_id, new.created_at)
     is distinct from (old.id, old.account_id, old.user_id, old.created_at) then
    raise exception 'A team member cannot be moved to another account or login' using errcode = '42501';
  end if;

  v_is_self := old.user_id = auth.uid();

  -- ON DELETE SET NULL from account_roles: the role is already gone.
  v_role_cascade := new.role_id is null and old.role_id is not null
    and not exists (select 1 from account_roles where id = old.role_id);

  -- Someone else's personal columns.
  if not v_is_self
     and (new.full_name, new.color, new.photo_storage_path, new.theme_preference, new.language_preference, new.dashboard_layout)
         is distinct from (old.full_name, old.color, old.photo_storage_path, old.theme_preference, old.language_preference, old.dashboard_layout)
     and not has_permission(old.account_id, 'team_admin') then
    raise exception 'Only a team admin can change another team member''s profile' using errcode = '42501';
  end if;

  -- Administrative columns, on anyone's row including your own.
  if (new.role, new.is_practitioner, new.online_booking_enabled, new.business_hours, new.deleted_at)
       is distinct from (old.role, old.is_practitioner, old.online_booking_enabled, old.business_hours, old.deleted_at)
     or (new.role_id is distinct from old.role_id and not v_role_cascade) then
    if not has_permission(old.account_id, 'team_admin') then
      raise exception 'Only a team admin can change roles, practitioner status, booking, hours or deactivation' using errcode = '42501';
    end if;
  end if;

  if v_is_self and new.role_id is distinct from old.role_id and not v_role_cascade and not v_caller_is_owner then
    raise exception 'Only an owner can change your role' using errcode = '42501';
  end if;

  v_loses_owner := old.is_owner and old.deleted_at is null and not (new.is_owner and new.deleted_at is null);

  if new.is_owner is distinct from old.is_owner or v_loses_owner then
    if not v_caller_is_owner then
      raise exception 'Only an owner can change who owns the account' using errcode = '42501';
    end if;
  end if;

  if v_loses_owner then
    -- Serialises two owners demoting each other at the same moment.
    perform 1 from accounts where id = old.account_id for update;
    if not exists (
      select 1 from team_members o
      where o.account_id = old.account_id and o.id <> old.id and o.is_owner and o.deleted_at is null
    ) then
      raise exception 'An account needs at least one owner. Make someone else an owner first.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

revoke execute on function public.guard_team_member_write() from public, anon, authenticated;

drop trigger if exists guard_team_member_write on public.team_members;
create trigger guard_team_member_write
  before update or delete on public.team_members
  for each row execute function public.guard_team_member_write();

-- ------------------------------------------------------- team_member_clinics
drop policy if exists "staff manage team_member_clinics" on public.team_member_clinics;

create policy "staff view team_member_clinics" on public.team_member_clinics
  for select using (
    exists (select 1 from team_members tm where tm.id = team_member_id and is_account_member(tm.account_id))
  );

create policy "team admins manage team_member_clinics" on public.team_member_clinics
  for all using (
    exists (
      select 1 from team_members tm
      where tm.id = team_member_id and is_account_member(tm.account_id) and has_permission(tm.account_id, 'team_admin')
    )
  ) with check (
    exists (
      select 1 from team_members tm
      join clinics c on c.id = clinic_id and c.account_id = tm.account_id
      where tm.id = team_member_id and is_account_member(tm.account_id) and has_permission(tm.account_id, 'team_admin')
    )
  );
