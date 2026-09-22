-- "Access docs and files from another practitioner" -- a second, independent
-- axis on patient_docs and patient_files, scoping them by WHO CREATED the
-- record rather than by whose patient it is.
--
-- The patient-based version of this already exists and is not what was asked
-- for: patients_scope = 'own' hides the entire patient from a practitioner,
-- documents included. The clinic that asked for this runs its Practitioner
-- role at patients_scope = 'all' on purpose -- practitioners cover for each
-- other and need the whole patient list -- and wants the clinical paperwork
-- to stay with its author anyway. So this narrows docs/files alone, on top of
-- the patient scope, and changes nothing else.
--
-- Both author columns already exist and already reference team_members:
-- patient_docs.created_by and patient_files.uploaded_by.
--
-- UNATTRIBUTED RECORDS STAY VISIBLE TO EVERYONE, which is why every clause
-- below says `... is null or ...` rather than a plain equality. The
-- PracticeHub import never carried an author through: on the live account
-- 2,754 of 2,763 documents and 2,588 of 2,646 files have no author at all.
-- Treating "no author recorded" as "not yours" would hide about 98% of eight
-- years of clinical history from every practitioner -- including records for
-- their own patients -- the moment an owner flipped this on. Attributing that
-- history by guesswork (the patient's default practitioner, say) would be
-- worse: a covering practitioner's upload would be credited to someone else
-- and then hidden from whoever actually made it. The restriction applies to
-- records created from here on, where authorship is a fact rather than an
-- inference, and the separation builds up as the clinic works.
--
-- WRITTEN IN THE HOISTED STYLE 0143/0144 ESTABLISHED, not the per-row style
-- 0045 used. can_access_patient() is SECURITY DEFINER, so Postgres cannot
-- inline it and calls it once per row; 0143 measured that at 0.64ms a call
-- and 2.1 seconds on a `select count(*) from payments`, and rewrote these two
-- tables' SELECT policies to resolve the caller's access once into a set the
-- planner can hash. A new `can_access_record_author(account_id, created_by)`
-- helper would have walked straight back into the same trap on the same two
-- tables. So the author test is a set probe too, and it reuses
-- my_team_member_identities() from 0144 rather than adding a second way to
-- ask the same question.

-- Existing roles are given the key explicitly rather than left to fall back.
-- permission_scope() returns 'none' for a key a role does not carry -- which
-- is not 'own', so the policies below would already leave such a role alone --
-- but storing it keeps the roles editor honest (it shows DEFAULTS for a
-- missing key, which would read 'own' and misrepresent what is in force) and
-- makes the value something an owner chose rather than something inferred.
update account_roles
set permissions = permissions || '{"docs_files_scope": "all"}'::jsonb
where not (permissions ? 'docs_files_scope');

-- Mirrors my_all_patient_scope_accounts() from 0143 exactly, for the opposite
-- polarity: the accounts where this caller IS restricted, since 'own' is the
-- narrow setting and every other value (including a missing key) means no
-- narrowing at all. Failing open here is deliberate and is not a hole -- this
-- axis only ever subtracts from what the patient scope already allowed, and
-- account membership plus can_access_patient() still sit above it.
create or replace function public.my_own_docs_scope_accounts()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id
  from team_members tm
  where tm.user_id = auth.uid()
    and tm.deleted_at is null
    and permission_scope(tm.account_id, 'docs_files_scope') = 'own';
$function$;

revoke all on function public.my_own_docs_scope_accounts() from public;
grant execute on function public.my_own_docs_scope_accounts() to authenticated;

-- patient_docs --------------------------------------------------------------
-- alter policy, not drop/create, so the 0143 SELECT expression survives
-- intact and only gains a conjunct. Insert is untouched throughout: creating
-- your own document is never the thing being restricted, and the row it
-- writes carries your own author id anyway.
alter policy "staff select patient_docs" on public.patient_docs
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or created_by is null
    or (account_id, created_by) in (select * from public.my_team_member_identities())
  )
);

-- Update and delete still carry the pre-0143 per-row form, because 0143 only
-- hoisted the SELECT hot path. Left as they are rather than rewritten here --
-- that is a separate change with its own risk -- but the new conjunct is
-- written hoisted regardless, so it costs nothing per row.
alter policy "staff update patient_docs" on public.patient_docs
using (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or created_by is null
    or (account_id, created_by) in (select * from public.my_team_member_identities())
  )
)
with check (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or created_by is null
    or (account_id, created_by) in (select * from public.my_team_member_identities())
  )
);

alter policy "staff delete patient_docs" on public.patient_docs
using (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and has_permission(account_id, 'patient_docs_delete')
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or created_by is null
    or (account_id, created_by) in (select * from public.my_team_member_identities())
  )
);

-- patient_files -------------------------------------------------------------
-- Same shape, but the author column here is uploaded_by, not created_by. The
-- separate "patients view own custom patient_files" policy (the patient
-- portal) is deliberately untouched: a patient reading their own file has
-- nothing to do with which practitioner uploaded it.
alter policy "staff select patient_files" on public.patient_files
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or uploaded_by is null
    or (account_id, uploaded_by) in (select * from public.my_team_member_identities())
  )
);

alter policy "staff update patient_files" on public.patient_files
using (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or uploaded_by is null
    or (account_id, uploaded_by) in (select * from public.my_team_member_identities())
  )
)
with check (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or uploaded_by is null
    or (account_id, uploaded_by) in (select * from public.my_team_member_identities())
  )
);

alter policy "staff delete patient_files" on public.patient_files
using (
  is_account_member(account_id) and can_access_patient(account_id, patient_id)
  and has_permission(account_id, 'patient_files_delete')
  and (
    account_id not in (select public.my_own_docs_scope_accounts())
    or uploaded_by is null
    or (account_id, uploaded_by) in (select * from public.my_team_member_identities())
  )
);

-- New accounts get the key stored rather than inferred, which is what
-- 20260914104205 set out to do ("so a stored Owner role is a complete record
-- rather than one the UI has to infer"). Taken verbatim from that migration
-- with one key added per role; nothing else about the seed changes, and the
-- `on conflict do nothing` inserts still leave existing accounts alone -- the
-- backfill above is what covers those.
--
-- Practitioner gets 'own', matching its visit_notes_scope and the least-
-- privilege reasoning there: a practitioner's default view is their own work,
-- and widening it is one dropdown an owner can reach. Front Desk gets 'all'
-- even though it has no clinical notes access at all -- chasing consent forms
-- and insurance paperwork across the whole patient list IS the job, and
-- scoping documents by author would break it for no benefit, since the role
-- is not a practitioner and authors nothing.

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
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
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
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false,
    "docs_files_scope": "all"
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
