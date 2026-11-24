-- progress_access: "Ver progreso", a role permission of its own for the
-- patient record's Progreso tab.
--
-- The tab -- the pain curve (visit_pain_scores), what was adjusted at each
-- visit (visit_listings), posture and squat assessments and the comparisons
-- sent to the patient -- sat behind visit_notes_access, in the app and in
-- every one of those tables' policies. So a clinic could not let reception
-- see how a patient is progressing without also handing them every clinical
-- note, and Settings > Roles never mentioned the tab at all: it was looked
-- for there and not found.
--
-- progress_access is READ access to that tab. Taking an assessment, scoring
-- pain, sending a comparison to the patient and deleting anything stay where
-- they were (visit_notes_access / _edit / _delete). visit_notes_access keeps
-- including it -- a role that reads the notes reads the progress made under
-- them -- which is why every select policy below is "either", and why no role
-- that sees the tab today stops seeing it.

-- ------------------------------------------------------------ existing roles

-- Every role that sees the tab today keeps a stored true, so the editor
-- shows what is in force; every other role gets an explicit false.
update public.account_roles
set permissions = permissions || jsonb_build_object(
  'progress_access', coalesce((permissions->>'visit_notes_access')::boolean, false)
)
where not (permissions ? 'progress_access');

-- ------------------------------------------------------------ read policies

drop policy if exists "staff select visit_pain_scores" on public.visit_pain_scores;
create policy "staff select visit_pain_scores" on public.visit_pain_scores for select
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'progress_access') or public.has_permission(account_id, 'visit_notes_access'))
  );

drop policy if exists "staff select visit_listings" on public.visit_listings;
create policy "staff select visit_listings" on public.visit_listings for select
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'progress_access') or public.has_permission(account_id, 'visit_notes_access'))
  );

drop policy if exists "staff select posture_assessments" on public.posture_assessments;
create policy "staff select posture_assessments" on public.posture_assessments for select
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'progress_access') or public.has_permission(account_id, 'visit_notes_access'))
  );

drop policy if exists "staff select posture_comparisons" on public.posture_comparisons;
create policy "staff select posture_comparisons" on public.posture_comparisons for select
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'progress_access') or public.has_permission(account_id, 'visit_notes_access'))
  );

-- ------------------------------------------------------------ restated

-- New accounts: seed_account_roles as 20261109181443 left it, with
-- progress_access on for Owner and Practitioner and off for Front Desk --
-- the same as visit_notes_access, so a new clinic starts exactly where an
-- existing one is after the update above.
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
  v_front_desk_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
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
