-- Two decisions about roles, taken after 20260925074722 made both keys do
-- something (25 Sep 2026).
--
-- 1. patients_tags_remove means "remove ANY tag", not only a tag named after
--    one of the clinic's bonos or memberships. That narrower rule protected
--    nothing in practice: QuiroFlow never writes bono tags and records no
--    tag's origin, and not one of production's 523 tagged patients carried a
--    tag matching a bono or membership name -- their tags are care-plan
--    frequencies ("2X3 1X6").
--
--    Widening it would, on its own, stop every role without the key removing
--    tags it removes today. So every role that can edit patients is granted
--    it here, which leaves behaviour exactly as it was; a clinic that wants
--    reception not to remove tags unticks it on the role.
--
-- 2. Front Desk sells bonos and memberships: packages_edit is on for the
--    seeded Front Desk role, for existing accounts and new ones.

-- 1a. Nobody loses what they can do today.
update account_roles
set permissions = permissions || '{"patients_tags_remove": true}'::jsonb
where coalesce((permissions->>'patients_edit')::boolean, false)
  and not coalesce((permissions->>'patients_tags_remove')::boolean, false);

-- 1b. The rule itself: any tag taken off, by a signed-in person, needs the key.
-- Server paths (no auth.uid()) are unchanged -- each has its own authorisation.
create or replace function public.patient_tag_removal_needs_permission()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.tags is not distinct from old.tags or (select auth.uid()) is null then
    return new;
  end if;
  if exists (
    select 1 from unnest(coalesce(old.tags, '{}')) t
    where not exists (select 1 from unnest(coalesce(new.tags, '{}')) n where lower(btrim(n)) = lower(btrim(t)))
  ) and not has_permission(new.account_id, 'patients_tags_remove') then
    raise exception 'Your role cannot remove patient tags' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- 2. Front Desk sells bonos and memberships.
update account_roles
set permissions = permissions || '{"packages_edit": true}'::jsonb
where name = 'Front Desk' and not is_system
  and not coalesce((permissions->>'packages_edit')::boolean, false);

-- New accounts: seed_account_roles as 20260925074722 left it (verified against
-- the database, md5 7369b4be...), with Practitioner and Front Desk granted
-- patients_tags_remove and Front Desk packages_edit.
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
    "docs_files_scope": "all"
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
    "docs_files_scope": "own"
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
    "patients_tags_remove": true, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false,
    "docs_files_scope": "all"
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
