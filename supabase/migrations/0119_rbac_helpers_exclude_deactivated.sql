-- Defense in depth for staff deactivation (0118): a deactivated team member's
-- existing JWT stays technically valid until it naturally expires even
-- though their login is banned going forward, so these RLS-backing helpers
-- (used across nearly every policy in the app) now also stop granting
-- access the moment deleted_at is set, rather than relying solely on the
-- auth ban catching up on next token refresh.
create or replace function current_team_member_id(target_account_id uuid)
returns uuid
language sql
security definer
stable
set search_path to 'public'
as $$
  select id from team_members where account_id = target_account_id and user_id = auth.uid() and deleted_at is null;
$$;

create or replace function has_permission(target_account_id uuid, perm_key text)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    exists (
      select 1 from team_members tm
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
    )
    or coalesce((
      select (r.permissions ->> perm_key)::boolean
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.deleted_at is null
    ), false);
$$;

create or replace function permission_scope(target_account_id uuid, perm_key text)
returns text
language sql
security definer
stable
set search_path to 'public'
as $$
  select case
    when exists (
      select 1 from team_members tm
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
    ) then 'all'
    else coalesce((
      select r.permissions ->> perm_key
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.deleted_at is null
    ), 'none')
  end;
$$;

create or replace function get_my_permissions(target_account_id uuid)
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $$
  select case
    when exists (
      select 1 from team_members tm
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
    ) then (select permissions from account_roles where account_id = target_account_id and name = 'Owner')
    else coalesce((
      select r.permissions
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.deleted_at is null
    ), '{}'::jsonb)
  end;
$$;
