-- Letters: what the staff write about a patient and hand over or send on --
-- "Informe para su médico de cabecera", a derivación, a certificado de
-- tratamiento -- on the clinic's letterhead. From the PracticeHub 2.0
-- comparison, 22 Oct 2026: PracticeHub has Settings > Letter Templates, and
-- our own clinic keeps a justificante and a data-protection letter there.
--
-- Not doc_templates. Those are forms the PATIENT fills in and signs, built
-- from blocks; a letter is prose the clinic writes, start to finish, and
-- signs itself. The two share the merge-token syntax ({{first_name}},
-- utils/docFields.ts) and nothing else.
--
--   letter_templates   per account, edited in Settings > Letters
--                      (communication_config, as doc templates are). Seeded
--                      with two Spanish defaults, for every account now and
--                      for each new one by trigger, the way payment methods
--                      are (20260918081356).
--
--   patient_letters    one row per letter written, kept on the record. The
--                      body is the finished text, merge fields already
--                      filled in when the draft was made and edited after:
--                      what was handed over is what stays, whatever the
--                      template or the patient's details say later. The
--                      letterhead is read live, as the justificante's is --
--                      a reprint after the clinic moves shows the new address.
--
-- Bodies are a small HTML subset (p, br, b/strong, i/em, u, ul, ol, li) that
-- utils/letters.ts reduces everything to on the way in and out; the PDF is
-- drawn from that, never from the raw string.
--
-- A new patient_id column is three changes (CLAUDE.md): this table, the move
-- in merge_patients -- restated below from 20261021173018 with only the
-- patient_letters lines added -- and anonymisation, done as the family links
-- are (20261021171628): a trigger on the update that sets anonymized_at, so
-- the next version of anonymize_patient cannot forget it. Also two-factor,
-- the Data API grant and the audit trail, as every new table.
--
-- Nothing live reads or drops anything here, so the code already deployed is
-- unaffected until the release that uses it.

-- ---------------------------------------------------------------------------
-- Templates

create table public.letter_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null constraint letter_templates_name_length check (length(btrim(name)) between 1 and 120),
  body text not null default '' constraint letter_templates_body_length check (length(body) <= 100000),
  -- The clinic's logo at the top of the page. Name, NIF and address are
  -- always there: a letter on letterhead without them is not one.
  show_logo boolean not null default true,
  created_by uuid references public.team_members(id) on delete set null,
  updated_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index letter_templates_account_idx on public.letter_templates (account_id, name);
create index letter_templates_created_by_idx on public.letter_templates (created_by);
create index letter_templates_updated_by_idx on public.letter_templates (updated_by);
select public.grant_data_api('public.letter_templates');

alter table public.letter_templates enable row level security;

-- Everyone who writes letters reads the templates (doc_templates learned this
-- the hard way, 20260930053755); changing them is a Settings job.
create policy "staff read letter_templates" on public.letter_templates for select
  using (public.is_account_member(account_id));
create policy "staff insert letter_templates" on public.letter_templates for insert
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));
create policy "staff update letter_templates" on public.letter_templates for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));
create policy "staff delete letter_templates" on public.letter_templates for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.letter_templates');

-- ---------------------------------------------------------------------------
-- Letters on the record

create table public.patient_letters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- Where it started from; a deleted template leaves its letters as they are.
  template_id uuid references public.letter_templates(id) on delete set null,
  -- Whose letterhead: the clinic it was written from. Null (or a clinic since
  -- deleted) falls back to the account's first, as receipts do.
  clinic_id uuid references public.clinics(id) on delete set null,
  title text not null constraint patient_letters_title_length check (length(btrim(title)) between 1 and 200),
  body text not null default '' constraint patient_letters_body_length check (length(body) <= 100000),
  show_logo boolean not null default true,
  created_by uuid references public.team_members(id) on delete set null,
  updated_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patient_letters_patient_idx on public.patient_letters (patient_id, created_at desc);
create index patient_letters_account_idx on public.patient_letters (account_id);
create index patient_letters_template_idx on public.patient_letters (template_id) where template_id is not null;
create index patient_letters_clinic_idx on public.patient_letters (clinic_id) where clinic_id is not null;
create index patient_letters_created_by_idx on public.patient_letters (created_by);
create index patient_letters_updated_by_idx on public.patient_letters (updated_by);
select public.grant_data_api('public.patient_letters');

alter table public.patient_letters enable row level security;

-- Seen as the record's documents are (patient_docs, 20260922133153): whoever
-- may see the patient, narrowed to their own letters under the role's "own"
-- documents scope.
create policy "staff select patient_letters" on public.patient_letters for select
  using (
    public.is_account_member(account_id)
    and public.can_access_patient(account_id, patient_id)
    and (
      account_id not in (select public.my_own_docs_scope_accounts())
      or created_by is null
      or (account_id, created_by) in (select * from public.my_team_member_identities())
    )
  );
-- Writing one is editing the record (patients_edit), for a patient of this
-- account, from a template of this account.
create policy "staff insert patient_letters" on public.patient_letters for insert
  with check (
    public.is_account_member(account_id)
    and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_letters.account_id)
    and (template_id is null or exists (select 1 from public.letter_templates lt where lt.id = template_id and lt.account_id = patient_letters.account_id))
    and (clinic_id is null or exists (select 1 from public.clinics c where c.id = clinic_id and c.account_id = patient_letters.account_id))
  );
create policy "staff update patient_letters" on public.patient_letters for update
  using (
    public.is_account_member(account_id)
    and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id)
    and (
      account_id not in (select public.my_own_docs_scope_accounts())
      or created_by is null
      or (account_id, created_by) in (select * from public.my_team_member_identities())
    )
  )
  with check (
    public.is_account_member(account_id)
    and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_letters.account_id)
    and (clinic_id is null or exists (select 1 from public.clinics c where c.id = clinic_id and c.account_id = patient_letters.account_id))
  );
-- Deleting is the documents' own permission.
create policy "staff delete patient_letters" on public.patient_letters for delete
  using (
    public.is_account_member(account_id)
    and public.has_permission(account_id, 'patient_docs_delete')
    and public.can_access_patient(account_id, patient_id)
    and (
      account_id not in (select public.my_own_docs_scope_accounts())
      or created_by is null
      or (account_id, created_by) in (select * from public.my_team_member_identities())
    )
  );
select public.require_two_factor_on('public.patient_letters');

-- A letter keeps its account and who wrote it. Not its patient: that is
-- what merge_patients changes, and pinning it here would undo the move and
-- let the duplicate's delete cascade the letter away. The update policy
-- keeps the patient inside the account instead.
create or replace function public.letters_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'patient_letters' then
    new.created_by := old.created_by;
  end if;
  new.account_id := old.account_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger letter_templates_touch before update on public.letter_templates
  for each row execute function public.letters_touch();
create trigger patient_letters_touch before update on public.patient_letters
  for each row execute function public.letters_touch();

-- Anonymising a record takes its letters with it: they are about the person,
-- by name, and often clinical.
create or replace function public.patients_drop_letters_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_letters where patient_id = new.id;
  end if;
  return new;
end;
$$;
create trigger patients_drop_letters_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_letters_on_anonymize();

-- ---------------------------------------------------------------------------
-- The audit trail. Adds the two types to whatever the constraint allows when
-- this runs, rather than restating the list (20261022173310 explains why:
-- several branches are adding types at once).
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['letter_template', 'patient_letter']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_letter_templates after insert or update or delete on public.letter_templates
  for each row execute function public.fn_audit_log('letter_template', 'updated_at');
create trigger trg_audit_patient_letters after insert or update or delete on public.patient_letters
  for each row execute function public.fn_audit_log('patient_letter', 'updated_at');

-- ---------------------------------------------------------------------------
-- Two editable defaults, in Spanish. The tokens are utils/docFields.ts's
-- LETTER_MERGE_FIELDS; a clinic deletes or rewrites them as it likes.

create or replace function public.seed_letter_templates(p_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.letter_templates (account_id, name, body)
  values
    (p_account_id, 'Informe para su médico',
     '<p>{{today}}</p>'
     || '<p>Estimado/a compañero/a:</p>'
     || '<p>Le escribo en relación con <b>{{full_name}}</b>, con DNI {{national_id}} y fecha de nacimiento {{date_of_birth}}, a quien atendemos en {{clinic_name}}.</p>'
     || '<p><b>Motivo de consulta:</b> {{chief_complaint}}</p>'
     || '<p><b>Valoración:</b> {{diagnosis}}</p>'
     || '<p><b>Tratamiento:</b> {{visit_count}} sesiones hasta la fecha; la última, el {{last_visit_date}}.</p>'
     || '<p><b>Recomendaciones:</b></p>'
     || '<ul><li></li></ul>'
     || '<p>Quedo a su disposición para cualquier aclaración.</p>'
     || '<p>Atentamente,</p>'
     || '<p><br></p><p><br></p>'
     || '<p>{{practitioner_name}}<br>{{clinic_name}}</p>'),
    (p_account_id, 'Certificado de asistencia a tratamiento',
     '<p><b>CERTIFICADO DE ASISTENCIA A TRATAMIENTO</b></p>'
     || '<p>{{practitioner_name}}, de {{clinic_name}} (NIF {{clinic_tax_id}}), con domicilio en {{clinic_address}},</p>'
     || '<p><b>CERTIFICA</b></p>'
     || '<p>Que {{full_name}}, con DNI {{national_id}}, recibe tratamiento en este centro, al que ha acudido en {{visit_count}} ocasiones, la última el {{last_visit_date}}.</p>'
     || '<p>Y para que conste a los efectos oportunos, firmo el presente certificado a {{today}}.</p>'
     || '<p><br></p><p><br></p>'
     || '<p>{{practitioner_name}}</p>');
$$;
revoke all on function public.seed_letter_templates(uuid) from public, anon, authenticated;

select public.seed_letter_templates(id) from public.accounts;

-- A trigger rather than an edit to create_account_with_owner, for the reason
-- payment methods give: signup is not the only thing that makes an account.
create or replace function public.seed_letter_templates_for_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_letter_templates(new.id);
  return new;
end;
$$;
create trigger accounts_seed_letter_templates
  after insert on public.accounts
  for each row execute function public.seed_letter_templates_for_new_account();

-- ---------------------------------------------------------------------------
-- merge_patients moves them too (CLAUDE.md). Unchanged from 20261021173018
-- but for the patient_letters statement after patient_files, and two blocks
-- after the facturas for tables other branches add while this one is open:
-- custom fields (patient_attribute_values, 20261022185051) and reasons for
-- stopping care (patient_care_stops, 20261022171626). Both restate this
-- function too. Their tables are moved here only once they exist, as
-- learn_sends was, so whichever order these apply in, the last version keeps
-- them -- as long as the branches that restate it after this one carry the
-- patient_letters lines in turn.
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

  -- Letters written about the person (patient_letters, 20261022185121).
  update patient_letters set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_letters', v_count);

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
  -- patient and field: the survivor keeps the answers it already has and only
  -- its blanks are filled from the duplicate's. Another branch's table, so
  -- named only once it exists; see the comment above this function.
  if to_regclass('public.patient_attribute_values') is not null then
    execute 'delete from public.patient_attribute_values d where d.patient_id = $2 and exists (select 1 from public.patient_attribute_values s where s.patient_id = $1 and s.attribute_id = d.attribute_id)' using p_survivor_id, p_duplicate_id;
    execute 'update public.patient_attribute_values set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('patient_attribute_values', v_count);
  end if;

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's. Named only once
  -- that branch's table exists; see the comment above this function.
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
