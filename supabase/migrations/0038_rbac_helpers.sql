create or replace function current_team_member_id(target_account_id uuid)
returns uuid
language sql
security definer
stable
set search_path to 'public'
as $$
  select id from team_members where account_id = target_account_id and user_id = auth.uid();
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
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner
    )
    or coalesce((
      select (r.permissions ->> perm_key)::boolean
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid()
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
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner
    ) then 'all'
    else coalesce((
      select r.permissions ->> perm_key
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid()
    ), 'none')
  end;
$$;

-- Returns the current user's resolved permissions for an account as a single jsonb
-- object, with owner-bypass already applied, so the client never re-implements it.
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
      where tm.account_id = target_account_id and tm.user_id = auth.uid() and tm.is_owner
    ) then (select permissions from account_roles where account_id = target_account_id and name = 'Owner')
    else coalesce((
      select r.permissions
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.account_id = target_account_id and tm.user_id = auth.uid()
    ), '{}'::jsonb)
  end;
$$;
