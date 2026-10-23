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
-- in merge_patients, and anonymisation. The move is already there:
-- 20261023053614_custom_patient_fields restated merge_patients with a
-- patient_letters block that runs once this table exists (to_regclass), so
-- this migration does not restate the function again -- one less copy of it
-- for the next branch to collide with. Anonymisation is done as the family
-- links are (20261021171628): a trigger on the update that sets
-- anonymized_at, so the next version of anonymize_patient cannot forget it.
-- Also two-factor, the Data API grant and the audit trail, as every new
-- table.
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
