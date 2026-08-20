create policy "staff view account_roles" on account_roles
  for select using (is_account_member(account_id));

create policy "roles admins insert account_roles" on account_roles
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'roles_admin'));

create policy "roles admins update account_roles" on account_roles
  for update using (is_account_member(account_id) and has_permission(account_id, 'roles_admin') and is_system = false)
  with check (is_account_member(account_id) and has_permission(account_id, 'roles_admin') and is_system = false);

create policy "roles admins delete account_roles" on account_roles
  for delete using (is_account_member(account_id) and has_permission(account_id, 'roles_admin') and is_system = false);

-- Seeds the 3 default roles for an account (idempotent), all fully permissive so
-- existing/new accounts see zero behavior change until an admin opts into narrowing.
-- Returns the seeded Owner role's id.
create or replace function seed_account_roles(target_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_role_id uuid;
  v_full_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": true, "roles_admin": true, "team_admin": true, "clinic_config": true,
    "billing_config": true, "communication_config": true, "data_admin": true,
    "billing_access": true, "recalls_access": true, "reports_access": true, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": true,
    "patients_tags_remove": true, "financials_edit_all": true, "financials_edit_same_day_only": false,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": true, "patient_files_delete": true,
    "visit_notes_access": true, "visit_notes_scope": "all", "visit_notes_edit": true, "visit_notes_delete": true
  }'::jsonb;
begin
  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Owner', true, v_full_permissions)
    on conflict (account_id, name) do update set permissions = account_roles.permissions
    returning id into v_owner_role_id;

  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Practitioner', false, v_full_permissions)
    on conflict (account_id, name) do nothing;

  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Front Desk', false, v_full_permissions)
    on conflict (account_id, name) do nothing;

  return v_owner_role_id;
end;
$function$;

-- Backfill: seed roles for every existing account, then wire up team_members/account_invites
do $$
declare
  v_account record;
begin
  for v_account in select id from accounts loop
    perform seed_account_roles(v_account.id);
  end loop;
end $$;

update team_members tm
set role_id = ar.id,
    is_owner = (tm.role = 'owner')
from account_roles ar
where ar.account_id = tm.account_id
  and ar.name = case tm.role when 'owner' then 'Owner' when 'front_desk' then 'Front Desk' else 'Practitioner' end
  and tm.role_id is null;

update account_invites ai
set role_id = ar.id
from account_roles ar
where ar.account_id = ai.account_id
  and ar.name = case ai.role when 'owner' then 'Owner' when 'front_desk' then 'Front Desk' else 'Practitioner' end
  and ai.role_id is null
  and ai.accepted_at is null;
