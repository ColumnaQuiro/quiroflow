-- leads_access: "Ver leads", a role permission of its own for the lead side
-- of Growth.
--
-- The Leads board, a lead's drawer and thread, converting a lead, lead
-- conversations in the Inbox, and sending a lead WhatsApp -- all behind
-- communication_config, "Communication and Growth", which is a SETTINGS
-- permission: WhatsApp setup, templates, saved replies, automations. So
-- reception could not answer the people an ad brought in without also being
-- able to rewrite the clinic's templates and automations.
--
-- leads_access opens that lead side on its own. communication_config keeps
-- including it (the routes accept either: server/utils/requireGrowth.ts,
-- requireLeads), so no role loses anything; the rest of Growth -- Overview,
-- AI receptionist, Reputation -- stays under communication_config.
--
-- Enforced in the routes, which is where the Leads board always was. The
-- lead tables' own policies are member-wide, as they were: My Day's tasks,
-- the Inbox and reports read a lead's name for roles that have no Growth at
-- all, and narrowing them is a change of its own.

update public.account_roles
set permissions = permissions || jsonb_build_object(
  'leads_access', coalesce((permissions->>'communication_config')::boolean, false)
)
where not (permissions ? 'leads_access');

-- ------------------------------------------------------------ restated

-- New accounts: seed_account_roles as 20261124175452 left it, with
-- leads_access as communication_config (Owner only), so a new clinic starts
-- exactly where an existing one is after the update above.
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
    "leads_access": true,
    "developers_access": true,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": true, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": true,
    "patients_tags_remove": true, "financials_edit_all": true, "financials_edit_same_day_only": false,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": true, "patient_files_delete": true,
    "visit_notes_access": true, "visit_notes_scope": "all", "visit_notes_edit": true, "visit_notes_delete": true,
    "progress_access": true,
    "docs_files_scope": "all", "exercises_manage": true
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
    "leads_access": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": false,
    "reports_access": true, "reports_own_only": true,
    "appointments_delete": false, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": true, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": false, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": true, "visit_notes_scope": "own", "visit_notes_edit": true, "visit_notes_delete": false,
    "progress_access": true,
    "docs_files_scope": "own", "exercises_manage": true
  }'::jsonb;

  -- The whole diary and patient list, because booking for anyone is the job.
  -- Takes payments and allocates them, answers WhatsApp. Deletes appointments
  -- (a mis-booking is theirs to undo) but not patients, documents or files.
  --
  -- visit_notes_access is false and that is the point of this role existing
  -- separately from Practitioner. progress_access is false too, as pain and
  -- posture are clinical; a clinic whose reception shows patients their
  -- progress turns it on in Settings > Roles without touching the notes.
  -- leads_access is off as communication_config is: a clinic whose reception
  -- answers its leads turns it on there.
  v_front_desk_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "leads_access": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": false, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": true, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false,
    "progress_access": false,
    "docs_files_scope": "all", "exercises_manage": false
  }'::jsonb;
begin
  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Owner', true, v_owner_permissions,
            'Acceso total. No se puede editar: lo que decide el acceso de un propietario es ser propietario, no el rol.')
    on conflict (account_id, name) do update set permissions = account_roles.permissions
    returning id into v_owner_role_id;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Practitioner', false, v_practitioner_permissions,
            'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.')
    on conflict (account_id, name) do nothing;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Front Desk', false, v_front_desk_permissions,
            'Lleva la agenda y el mostrador: todos los pacientes y citas, cobros, caja y bandeja de entrada.')
    on conflict (account_id, name) do nothing;

  return v_owner_role_id;
end;
$function$;
