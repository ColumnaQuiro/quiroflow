-- has_permission()'s owner bypass returns true for ANY permission key when
-- the caller is the account owner -- correct for grant-style flags
-- (roles_admin, billing_access, ...) where owners should always pass, but
-- wrong for restriction-style flags like calendar_read_only, where it means
-- "not has_permission(account_id, 'calendar_read_only')" evaluates to false
-- for every owner regardless of the role's actual (false) value, silently
-- blocking owners from ever inserting/updating an appointment.
--
-- has_restriction() mirrors has_permission()'s role lookup but deliberately
-- skips the owner bypass, since restriction flags should never apply to the
-- account owner.
create or replace function has_restriction(target_account_id uuid, perm_key text)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    not exists (
      select 1 from team_members tm
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner
    )
    and coalesce((
      select (r.permissions ->> perm_key)::boolean
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid()
    ), false);
$$;

revoke execute on function has_restriction(uuid, text) from public;
revoke execute on function has_restriction(uuid, text) from anon;
grant execute on function has_restriction(uuid, text) to authenticated;

drop policy "staff insert appointments" on appointments;
drop policy "staff update appointments" on appointments;

create policy "staff insert appointments" on appointments
  for insert with check (
    is_account_member(account_id)
    and permission_scope(account_id, 'calendar_scope') != 'none'
    and not has_restriction(account_id, 'calendar_read_only')
  );

create policy "staff update appointments" on appointments
  for update using (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
    and not has_restriction(account_id, 'calendar_read_only')
  )
  with check (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
    and not has_restriction(account_id, 'calendar_read_only')
  );
