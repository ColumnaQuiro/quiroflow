-- Default roles stopped being copies of Owner.
--
-- seed_account_roles handed the SAME jsonb -- v_full_permissions -- to all
-- three roles it creates. So every clinic that signed up got a "Front Desk"
-- role holding roles_admin, team_admin, data_admin, billing_config and full
-- access to appointment notes. A receptionist put on the role the product
-- named for receptionists could rewrite the permission system, add and remove
-- team members, run data imports and webhooks, read the Stripe configuration,
-- and read and delete every patient's clinical notes.
--
-- Nothing was broken about the permission machinery: the roles editor exposes
-- all of this and an owner could narrow it by hand. The defaults were simply
-- the widest possible set, so a clinic that never opened Settings > Roles was
-- running with no separation of duties at all, and had no way to know.
--
-- Least privilege instead, per role:
--
--   Practitioner -- a clinician. Their own diary, their own patients, their
--     own notes. Charges the visits they do. No settings of any kind.
--   Front Desk   -- the front of house. The whole diary and patient list,
--     takes payments, works the WhatsApp inbox. No settings, and NO clinical
--     notes: a receptionist has no clinical reason to read them, and they are
--     the most sensitive data in the product.
--   Owner        -- unchanged, still everything.
--
-- EXISTING ACCOUNTS ARE NOT TOUCHED. The inserts below are
-- `on conflict do nothing`, so this changes what a NEW account is created
-- with and nothing else. Narrowing the roles of a clinic already working
-- under them would take someone's access away mid-shift, which is a decision
-- for that clinic's owner, not for a migration.
create or replace function public.seed_account_roles(target_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_role_id uuid;

  -- Owner keeps everything. developers_access and inbox_access were added to
  -- the permission model after this function was last written and never made
  -- it into the seeded set; they are here now so a stored Owner role is a
  -- complete record rather than one the UI has to infer.
  v_owner_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": true, "roles_admin": true, "team_admin": true, "clinic_config": true,
    "billing_config": true, "communication_config": true, "data_admin": true,
    "developers_access": true,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": true, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": true,
    "patients_tags_remove": true, "financials_edit_all": true, "financials_edit_same_day_only": false,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": true, "patient_files_delete": true,
    "visit_notes_access": true, "visit_notes_scope": "all", "visit_notes_edit": true, "visit_notes_delete": true
  }'::jsonb;

  -- Scoped to "own" throughout: a practitioner's default view is their own
  -- work. Widening it to the whole clinic is one dropdown in Settings > Roles
  -- and many clinics will want that -- but it should be a decision someone
  -- made, not the state they were handed.
  --
  -- They can charge a visit (billing_access, financials same-day) because
  -- that is the end of an appointment, but cannot reallocate historical
  -- payments, edit packages, or delete anything: appointments, patients,
  -- documents, files and their own past notes all stay put.
  v_practitioner_permissions jsonb := '{
    "dashboard_scope": "own", "calendar_scope": "own", "patients_scope": "own",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": false,
    "reports_access": true, "reports_own_only": true,
    "appointments_delete": false, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": false, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": true, "visit_notes_scope": "own", "visit_notes_edit": true, "visit_notes_delete": false
  }'::jsonb;

  -- The whole diary and patient list, because booking for anyone is the job.
  -- Takes payments and allocates them, answers WhatsApp. Deletes appointments
  -- (a mis-booking is theirs to undo) but not patients, documents or files.
  --
  -- visit_notes_access is false and that is the point of this role existing
  -- separately from Practitioner.
  v_front_desk_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": false, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false
  }'::jsonb;
begin
  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Owner', true, v_owner_permissions)
    on conflict (account_id, name) do update set permissions = account_roles.permissions
    returning id into v_owner_role_id;

  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Practitioner', false, v_practitioner_permissions)
    on conflict (account_id, name) do nothing;

  insert into account_roles (account_id, name, is_system, permissions)
    values (target_account_id, 'Front Desk', false, v_front_desk_permissions)
    on conflict (account_id, name) do nothing;

  return v_owner_role_id;
end;
$function$;

-- Restores what 0042_rbac_lock_down_seed_function.sql intended. That revoke
-- was undone somewhere along the way -- the live function currently grants
-- EXECUTE to anon -- and `create or replace` above would have carried the
-- same grants forward, so it is reasserted here rather than assumed.
--
-- Nothing legitimate loses access: create_account_with_owner is itself
-- SECURITY DEFINER, so its internal call runs as the function's owner and
-- never as the caller. Signup is unaffected.
revoke execute on function public.seed_account_roles(uuid) from anon, authenticated;
