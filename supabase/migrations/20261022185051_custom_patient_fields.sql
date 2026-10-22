-- Custom patient fields: each clinic adds its own fields to the patient's
-- record, beyond the fixed columns -- "Mutua / nº póliza", "Deporte que
-- practica", "Lateralidad", "Consentimiento fotos". PracticeHub calls them
-- Custom Patient Attributes, with a Clinical and an Admin tab; asked for on
-- 22 Oct 2026 after comparing the two.
--
-- Two tables. patient_attributes is the clinic's list of fields (Settings >
-- Custom fields); patient_attribute_values holds one row per patient and
-- field that has an answer. A blank is no row, not an empty one.
--
-- The section is what decides who reads a value. A clinical field is read
-- like a visit note, under visit_notes_access; an admin field like the rest
-- of the record. That is enforced here, on the values, so a role without
-- clinical access gets no rows back from the API at all -- not rows the
-- screen happens to hide.
--
-- Values are text, in one form per kind so that anything reading them (the
-- record, the export, a document's merge field) needs no type of its own:
-- a number as typed with a dot, a date as YYYY-MM-DD, yes/no as true/false, a
-- choice as the option's text. The trigger below refuses anything else.
--
-- A new patient_id column is three changes (CLAUDE.md): this table, the move
-- in merge_patients -- restated below from 20261021173018 with the
-- patient_attribute_values lines added -- and anonymisation, done as the
-- family links are (20261021171628): a trigger on the update that sets
-- anonymized_at. Also two-factor, the Data API grants and the audit trail.

create table public.patient_attributes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  -- The {{attr_<key>}} merge field in document templates. Made from the label
  -- when the field is created and kept when it is renamed, so a template
  -- written against it keeps working.
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  section text not null check (section in ('clinical', 'admin')),
  kind text not null check (kind in ('text', 'long_text', 'number', 'date', 'boolean', 'choice')),
  options text[] not null default '{}',
  position int not null default 0,
  -- Archived fields leave the record and the forms; their values stay, in
  -- the export and for when the field is restored.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_attributes_key_uniq unique (account_id, key),
  constraint patient_attributes_choice_has_options check (kind <> 'choice' or cardinality(options) > 0)
);
create index patient_attributes_account_idx on public.patient_attributes (account_id, position);
select public.grant_data_api('public.patient_attributes');

alter table public.patient_attributes enable row level security;
create policy "staff select patient_attributes" on public.patient_attributes for select
  using (public.is_account_member(account_id));
-- Under the permission of the Settings page that lists them, as appointment
-- types and the new-patient fields are.
create policy "staff insert patient_attributes" on public.patient_attributes for insert
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'clinic_config'));
create policy "staff update patient_attributes" on public.patient_attributes for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'clinic_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'clinic_config'));
-- Deleting is for a field nobody has answered yet: the values' foreign key
-- (no action) refuses it otherwise, whoever asks and whatever they can see,
-- and the page offers Archive instead.
create policy "staff delete patient_attributes" on public.patient_attributes for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'clinic_config'));
select public.require_two_factor_on('public.patient_attributes');

create table public.patient_attribute_values (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- No action rather than cascade: deleting a field must not take its
  -- answers with it (see the delete policy above). Not RESTRICT, which is
  -- checked mid-statement and would refuse deleting the whole account, where
  -- both tables go at once.
  attribute_id uuid not null references public.patient_attributes(id),
  value text not null check (length(value) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.team_members(id) on delete set null,
  constraint patient_attribute_values_uniq unique (patient_id, attribute_id)
);
create index patient_attribute_values_attribute_idx on public.patient_attribute_values (attribute_id);
select public.grant_data_api('public.patient_attribute_values');

-- Whether the caller may read values of this field: every member for an
-- admin one, visit_notes_access for a clinical one. Definer, so the policy
-- does not recurse through patient_attributes' own.
create or replace function public.can_read_patient_attribute(p_attribute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_attributes a
     where a.id = p_attribute_id
       and public.is_account_member(a.account_id)
       and (a.section = 'admin' or public.has_permission(a.account_id, 'visit_notes_access'))
  );
$$;
revoke all on function public.can_read_patient_attribute(uuid) from public, anon;
grant execute on function public.can_read_patient_attribute(uuid) to authenticated, service_role;

alter table public.patient_attribute_values enable row level security;
create policy "staff select patient_attribute_values" on public.patient_attribute_values for select
  using (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and public.can_read_patient_attribute(attribute_id)
  );
-- Writing one is editing the patient's record, and the field and the patient
-- have to be this account's.
create policy "staff insert patient_attribute_values" on public.patient_attribute_values for insert
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id) and public.can_read_patient_attribute(attribute_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_attribute_values.account_id)
    and exists (select 1 from public.patient_attributes a where a.id = attribute_id and a.account_id = patient_attribute_values.account_id)
  );
create policy "staff update patient_attribute_values" on public.patient_attribute_values for update
  using (
    public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id) and public.can_read_patient_attribute(attribute_id)
  )
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id) and public.can_read_patient_attribute(attribute_id)
  );
create policy "staff delete patient_attribute_values" on public.patient_attribute_values for delete
  using (
    public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id) and public.can_read_patient_attribute(attribute_id)
  );
select public.require_two_factor_on('public.patient_attribute_values');

-- A value in the form its kind says, for a field of the same account, that
-- is not archived. Checked only when the value itself changes, so moving
-- a patient's answers in a merge never fails over a field archived since or
-- a choice whose options have been reworded.
create or replace function public.patient_attribute_values_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attr public.patient_attributes;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.value is not distinct from old.value and new.attribute_id = old.attribute_id then
    return new;
  end if;
  select * into v_attr from public.patient_attributes where id = new.attribute_id;
  if v_attr.account_id is distinct from new.account_id then
    raise exception 'That field belongs to another clinic';
  end if;
  if v_attr.archived_at is not null then
    raise exception 'The field "%" is archived', v_attr.label;
  end if;
  if v_attr.kind = 'number' and new.value !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception '"%" is not a number (field "%")', new.value, v_attr.label;
  elsif v_attr.kind = 'date' and (new.value !~ '^\d{4}-\d{2}-\d{2}$' or new.value::date is null) then
    raise exception '"%" is not a date (field "%")', new.value, v_attr.label;
  elsif v_attr.kind = 'boolean' and new.value not in ('true', 'false') then
    raise exception '"%" is not yes or no (field "%")', new.value, v_attr.label;
  elsif v_attr.kind = 'choice' and not (new.value = any (v_attr.options)) then
    raise exception '"%" is not one of the options of "%"', new.value, v_attr.label;
  elsif v_attr.kind = 'text' and length(new.value) > 500 then
    raise exception 'Too long for a short text field ("%")', v_attr.label;
  end if;
  return new;
end;
$$;
create trigger patient_attribute_values_check
  before insert or update on public.patient_attribute_values
  for each row execute function public.patient_attribute_values_check();

-- A field's kind is fixed once anyone has answered it: a date field turned
-- into yes/no would leave every stored date unreadable.
create or replace function public.patient_attributes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.kind is distinct from old.kind
     and exists (select 1 from public.patient_attribute_values v where v.attribute_id = new.id) then
    raise exception 'The type of "%" cannot change once patients have answers in it', old.label;
  end if;
  if new.account_id is distinct from old.account_id then
    raise exception 'A field cannot move to another clinic';
  end if;
  return new;
end;
$$;
create trigger patient_attributes_guard
  before update on public.patient_attributes
  for each row execute function public.patient_attributes_guard();

-- The audit trail (CLAUDE.md). Appended to whatever the constraint allows
-- when this runs rather than restated: several branches add entity types at
-- once, and a restated list drops every type added since it was written.
-- The same block as 20261022173310_patient_segments.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['patient_attribute', 'patient_attribute_value']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_patient_attributes after insert or update or delete on public.patient_attributes
  for each row execute function public.fn_audit_log('patient_attribute', 'position');
create trigger trg_audit_patient_attribute_values after insert or update or delete on public.patient_attribute_values
  for each row execute function public.fn_audit_log('patient_attribute_value');

-- Anonymising a record takes its answers with it: they are whatever the
-- clinic chose to ask, personal or clinical, and nothing here can tell which.
create or replace function public.patients_drop_attribute_values_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_attribute_values where patient_id = new.id;
  end if;
  return new;
end;
$$;
create trigger patients_drop_attribute_values_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_attribute_values_on_anonymize();

-- merge_patients moves them (CLAUDE.md). Unchanged from 20261021173018 but
-- for the patient_attribute_values block after the facturas addressed to the
-- duplicate, and patient_care_stops beside it: that table arrives in its own
-- branch (20261022171626), which restates this function too, so it is named
-- only once it exists -- whichever of the two applies second keeps both.
create or replace function merge_patients(p_survivor_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_dup_account_id uuid;
  v_moved jsonb := '{}'::jsonb;
  v_count int;
  v_dup_external_reference text;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'Cannot merge a patient into itself';
  end if;

  select account_id into v_account_id from patients where id = p_survivor_id;
  select account_id into v_dup_account_id from patients where id = p_duplicate_id;

  if v_account_id is null or v_dup_account_id is null then
    raise exception 'Both patients must exist';
  end if;
  -- Never merge across accounts: that would move one clinic's clinical and
  -- financial records into another's.
  if v_account_id <> v_dup_account_id then
    raise exception 'Both patients must belong to the same account';
  end if;
  if not is_account_member(v_account_id) then
    raise exception 'Not a member of this account';
  end if;
  if not has_permission(v_account_id, 'patients_delete_merge') then
    raise exception 'Missing permission: patients_delete_merge';
  end if;

  -- Ownership of bonos moves first, so the share cleanup below can see which
  -- bonos the survivor ends up owning.
  update package_purchases set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchases', v_count);

  -- `package_purchase_shares` is unique on (package_purchase_id, patient_id),
  -- and two rows of the duplicate's would now violate it or be meaningless:
  -- a bono the survivor already shares, and a bono the survivor now owns
  -- outright (you do not share a bono with yourself). Drop those, move the
  -- rest.
  delete from package_purchase_shares s
  where s.patient_id = p_duplicate_id
    and (
      exists (select 1 from package_purchase_shares o
               where o.package_purchase_id = s.package_purchase_id and o.patient_id = p_survivor_id)
      or exists (select 1 from package_purchases pp
                  where pp.id = s.package_purchase_id and pp.patient_id = p_survivor_id)
    );
  update package_purchase_shares set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchase_shares', v_count);

  -- Stripe allows one customer per patient per account. If the survivor
  -- already has one, keep it -- it is the one any saved card and active
  -- payment schedule is attached to -- and let the duplicate's row go.
  if exists (select 1 from patient_stripe_customers where patient_id = p_survivor_id and account_id = v_account_id) then
    delete from patient_stripe_customers where patient_id = p_duplicate_id;
  else
    update patient_stripe_customers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  end if;

  update account_credits set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('account_credits', v_count);

  update appointments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('appointments', v_count);

  update invoices set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('invoices', v_count);

  -- The money itself. `payments.patient_id` is `on delete cascade`, so before
  -- this line the delete at the end of the function destroyed every payment
  -- the duplicate held -- silently, and after reporting the merge a success.
  update payments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('payments', v_count);

  -- Facturas follow their payments onto the survivor. No huella is affected:
  -- the patient is not one of the hashed fields, and factura_records is keyed
  -- by factura, not by patient.
  update facturas set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas', v_count);

  update package_sessions set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_sessions', v_count);

  update care_plans set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_exercises set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_push_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update contact_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_app_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_contact_numbers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_memberships set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update payment_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update photo_upload_tokens set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update waitlist_entries set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update whatsapp_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- Automation runs follow the person: a patient halfway through a follow-up
  -- sequence carries on from where they were, on the surviving record, rather
  -- than having the run (and its history) cascade away with the duplicate.
  update automation_sequence_runs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('automation_sequence_runs', v_count);

  -- Mi día tasks an automation left about this person stay with the person.
  update staff_tasks set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('staff_tasks', v_count);

  -- The birthday guard is unique per (rule, patient, day). A day both records
  -- were already greeted on keeps the survivor's row; the rest move, so a
  -- merge on someone's birthday does not greet them a second time.
  delete from automation_birthday_sends d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from automation_birthday_sends s
                  where s.patient_id = p_survivor_id and s.rule_id = d.rule_id and s.local_date = d.local_date);
  update automation_birthday_sends set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- These three are `on delete set null`, so they outlive the duplicate
  -- either way -- but with the link to the person cut. A lead that converted
  -- would stop knowing which patient it became, and a review request would
  -- stop knowing who it was sent to. Same reasoning as whatsapp_messages
  -- above, which has always been moved despite being set null too.
  update email_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update leads set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update review_requests set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  update patient_docs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_docs', v_count);

  update patient_files set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_files', v_count);

  update posture_assessments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('posture_assessments', v_count);

  -- learn_sends arrives in its own migration, which redefines this function
  -- too; whichever lands second keeps both by naming the other's table only
  -- once it exists.
  if to_regclass('public.learn_sends') is not null then
    execute 'update public.learn_sends set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('learn_sends', v_count);
  end if;

  -- Other patients pointing AT the duplicate -- a child whose tutor is the
  -- duplicate record, someone the duplicate referred. These FKs are
  -- `on delete set null`, so leaving them would silently orphan a minor's
  -- tutor link. Repoint them, except where that would make the survivor its
  -- own tutor or its own referrer.
  update patients set tutor_patient_id = p_survivor_id
   where tutor_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set tutor_patient_id = null
   where id = p_survivor_id and tutor_patient_id = p_duplicate_id;
  update patients set referred_by_patient_id = p_survivor_id
   where referred_by_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set referred_by_patient_id = null
   where id = p_survivor_id and referred_by_patient_id = p_duplicate_id;

  -- Family links (patient_relations, 20261021171628), stored both ways. The
  -- duplicate's become the survivor's: a link between the two records
  -- themselves goes, and so does one the survivor already has to the same
  -- person, which the unique pair would refuse.
  delete from patient_relations
   where (patient_id = p_duplicate_id and related_patient_id = p_survivor_id)
      or (patient_id = p_survivor_id and related_patient_id = p_duplicate_id);
  delete from patient_relations d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.patient_id = p_survivor_id and s.related_patient_id = d.related_patient_id);
  delete from patient_relations d
   where d.related_patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.related_patient_id = p_survivor_id and s.patient_id = d.patient_id);
  update patient_relations set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_relations', v_count);
  update patient_relations set related_patient_id = p_survivor_id where related_patient_id = p_duplicate_id;

  -- Facturas addressed to the duplicate as a minor's tutor (recipient_patient_id,
  -- 20261021173018) are addressed to the survivor. Not a foreign key, so
  -- nothing would have stopped the delete below from leaving them pointing at
  -- a record that no longer exists.
  update facturas set recipient_patient_id = p_survivor_id where recipient_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas_addressed', v_count);

  -- Custom fields (patient_attribute_values, 20261022185051), one answer per
  -- patient and field. As for the columns below, the survivor keeps the
  -- answers it already has and only its blanks are filled from the
  -- duplicate's.
  delete from patient_attribute_values d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_attribute_values s where s.patient_id = p_survivor_id and s.attribute_id = d.attribute_id);
  update patient_attribute_values set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_attribute_values', v_count);

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's.
  if to_regclass('public.patient_care_stops') is not null then
    execute 'update public.patient_care_stops set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('patient_care_stops', v_count);
  end if;

  -- external_reference is unique per account (patients_external_reference_uniq)
  -- and the duplicate is only deleted at the end, so copying its reference
  -- onto the survivor below collided with the duplicate's own copy. That is
  -- the commonest pair there is -- a record made at the front desk and the
  -- PracticeHub import of the same person -- and the merge refused it with
  -- "duplicate key value". Take the reference off the duplicate first; the
  -- field merge reads it from here instead.
  select external_reference into v_dup_external_reference from patients where id = p_duplicate_id;
  if v_dup_external_reference is not null then
    update patients set external_reference = null where id = p_duplicate_id;
  end if;

  -- Field-level merge: the survivor keeps everything it already has, and only
  -- its blanks are filled from the duplicate. That is the direction that can
  -- never lose data the front desk deliberately typed -- picking the
  -- duplicate's value over a populated one would.
  --
  -- Arrays are unioned rather than replaced: a VIP tag or a marketing opt-in
  -- on either record belongs to the person, not to the row.
  --
  -- balance_cents is summed. It is not a live ledger -- it is the account
  -- balance written once at PracticeHub import (patient_live_balances is the
  -- computed one) -- so for two halves of one person the snapshot is the sum.
  update patients s set
    last_name              = coalesce(nullif(s.last_name, ''), d.last_name),
    date_of_birth          = coalesce(s.date_of_birth, d.date_of_birth),
    email                  = coalesce(nullif(s.email, ''), d.email),
    occupation             = coalesce(nullif(s.occupation, ''), d.occupation),
    emergency_contact      = coalesce(nullif(s.emergency_contact, ''), d.emergency_contact),
    referral_source        = coalesce(nullif(s.referral_source, ''), d.referral_source),
    notes                  = coalesce(nullif(s.notes, ''), d.notes),
    external_reference     = coalesce(nullif(s.external_reference, ''), v_dup_external_reference),
    address                = coalesce(nullif(s.address, ''), d.address),
    national_id            = coalesce(nullif(s.national_id, ''), d.national_id),
    sticky_note            = coalesce(nullif(s.sticky_note, ''), d.sticky_note),
    gender                 = coalesce(nullif(s.gender, ''), d.gender),
    chief_complaint        = coalesce(nullif(s.chief_complaint, ''), d.chief_complaint),
    red_flags              = coalesce(nullif(s.red_flags, ''), d.red_flags),
    yellow_flags           = coalesce(nullif(s.yellow_flags, ''), d.yellow_flags),
    diagnosis              = coalesce(nullif(s.diagnosis, ''), d.diagnosis),
    goals                  = coalesce(nullif(s.goals, ''), d.goals),
    postal_code            = coalesce(nullif(s.postal_code, ''), d.postal_code),
    city                   = coalesce(nullif(s.city, ''), d.city),
    country                = coalesce(nullif(s.country, ''), d.country),
    photo_storage_path     = coalesce(nullif(s.photo_storage_path, ''), d.photo_storage_path),
    clinic_id              = coalesce(s.clinic_id, d.clinic_id),
    default_practitioner_id = coalesce(s.default_practitioner_id, d.default_practitioner_id),
    user_id                = coalesce(s.user_id, d.user_id),
    tags                   = (select coalesce(array_agg(distinct x), '{}') from unnest(s.tags || d.tags) x),
    marketing_channels     = (select coalesce(array_agg(distinct x), '{}') from unnest(s.marketing_channels || d.marketing_channels) x),
    -- Who may be contacted, and through whom, belongs to the person: if
    -- either record says minor, the merged one does, and keeps the tutor its
    -- messages go to. Before this a child flagged minor on the record that
    -- was deleted became directly contactable. Never the patient's own tutor
    -- or referrer: the duplicate may point at the survivor.
    is_minor               = s.is_minor or d.is_minor,
    tutor_patient_id       = coalesce(s.tutor_patient_id,
                                      nullif(nullif(d.tutor_patient_id, p_survivor_id), p_duplicate_id)),
    referred_by_patient_id = coalesce(s.referred_by_patient_id,
                                      nullif(nullif(d.referred_by_patient_id, p_survivor_id), p_duplicate_id)),
    app_push_opted_out     = s.app_push_opted_out or d.app_push_opted_out,
    has_phone              = s.has_phone or d.has_phone,
    do_not_contact         = s.do_not_contact or d.do_not_contact,
    balance_cents          = s.balance_cents + d.balance_cents
  from patients d
  where s.id = p_survivor_id and d.id = p_duplicate_id;

  -- Every table keyed off the duplicate has been moved above, so the cascade
  -- has nothing left to take. That sentence was already here and was wrong
  -- for payments; the guard below is what makes it checkable rather than
  -- merely intended.
  --
  -- A table added to `patients` in future and forgotten here lands in exactly
  -- the same trap, and the next one may be as quiet as payments was. RESTRICT
  -- on facturas turns the fiscal case into a loud failure; this turns the
  -- money case into one too, at the cost of one count.
  if exists (select 1 from payments where patient_id = p_duplicate_id) then
    raise exception 'merge_patients would have deleted payments still on the duplicate record (patient %)', p_duplicate_id
      using errcode = 'restrict_violation';
  end if;

  delete from patients where id = p_duplicate_id;

  return v_moved;
end;
$$;
