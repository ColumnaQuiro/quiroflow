-- Keeping clinical records for as long as the law asks, and no longer
-- (Ajustes › Privacidad, pages/settings/privacy.vue). Owners only.
--
-- Ley 41/2002, art. 17: at least five years from each care process's
-- discharge; some comunidades ask more. Each clinic picks its period
-- (accounts.clinical_retention_years -- not listed in
-- accounts_settings_permission, so owner-only by construction). A record
-- with no visit, note, file, document or payment for longer than that is
-- "past its period": the owner either keeps it N years more, with a reason,
-- or anonymises it. Nothing happens by itself.
--
-- Anonymising (anonymize_patient) deletes the clinical record and the
-- person's contact details and leaves a nameless "Paciente anonimizado" row,
-- so appointments, invoices, facturas, payments and bonos -- which Hacienda
-- and VeriFactu need kept separately, and which the clinic's statistics
-- count -- stay intact. facturas.patient_id is RESTRICT anyway.
--
-- The audit trail (20261008070424) is append-only and keeps every version
-- of a note in `snapshot`/`changes`. Left alone, anonymising would leave the
-- whole clinical record readable in Settings › Activity. So inside
-- anonymize_patient -- and only there, flagged for this one patient in this
-- one transaction -- that patient's audit rows lose their snapshot and
-- changes; the rows themselves (who did what, when) stay, and one more says
-- who anonymised the record.
--
-- A NEW TABLE WITH A patient_id (or clinical text keyed to an appointment)
-- has to be added to anonymize_patient below, the same way it has to be
-- added to merge_patients (CLAUDE.md).

alter table public.accounts
  add column if not exists clinical_retention_years smallint not null default 5
    check (clinical_retention_years between 5 and 50);

alter table public.patients
  add column if not exists retention_kept_until date,
  add column if not exists retention_kept_reason text,
  add column if not exists anonymized_at timestamptz;

-- How long a signed document (a consent) stays valid; null = no expiry.
alter table public.doc_templates
  add column if not exists valid_months smallint check (valid_months is null or valid_months between 1 and 120);

-- ---------------------------------------------------------------------
-- Last activity, and which records are past their period
-- ---------------------------------------------------------------------
create or replace function public.patient_last_activity(p_patient_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select created_at from patients where id = p_patient_id),
    (select max(starts_at) from appointments where patient_id = p_patient_id and starts_at <= now()),
    (select max(vn.created_at) from visit_notes vn join appointments a on a.id = vn.appointment_id where a.patient_id = p_patient_id),
    (select max(created_at) from patient_files where patient_id = p_patient_id),
    (select max(coalesce(completed_at, created_at)) from patient_docs where patient_id = p_patient_id),
    (select max(paid_at) from payments where patient_id = p_patient_id)
  )
$$;
revoke all on function public.patient_last_activity(uuid) from public, anon, authenticated;

create or replace function public.retention_review(p_account_id uuid)
returns table (
  patient_id uuid,
  first_name text,
  last_name text,
  last_activity timestamptz,
  notes bigint,
  files bigint,
  facturas bigint,
  kept_until date,
  kept_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_years int;
begin
  if not public.is_account_owner(p_account_id) and auth.role() <> 'service_role' then
    raise exception 'Only an owner can review record retention' using errcode = 'insufficient_privilege';
  end if;
  select clinical_retention_years into v_years from accounts where id = p_account_id;
  return query
  with candidates as (
    select p.id, p.first_name, p.last_name, public.patient_last_activity(p.id) as last_activity, p.retention_kept_until, p.retention_kept_reason
    from patients p
    where p.account_id = p_account_id and p.anonymized_at is null
  )
  select c.id, c.first_name, c.last_name, c.last_activity,
    (select count(*) from visit_notes vn join appointments a on a.id = vn.appointment_id where a.patient_id = c.id),
    (select count(*) from patient_files f where f.patient_id = c.id),
    (select count(*) from facturas fa where fa.patient_id = c.id),
    c.retention_kept_until, c.retention_kept_reason
  from candidates c
  where c.last_activity < now() - make_interval(years => v_years)
  order by c.last_activity;
end;
$$;
revoke all on function public.retention_review(uuid) from public, anon;
grant execute on function public.retention_review(uuid) to authenticated;

-- "Conservar": N years more, with a reason. Null until clears it.
create or replace function public.keep_patient_record(p_patient_id uuid, p_until date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  select account_id into v_account from patients where id = p_patient_id;
  if v_account is null or not public.is_account_owner(v_account) then
    raise exception 'Only an owner can decide how long a record is kept' using errcode = 'insufficient_privilege';
  end if;
  if p_until is not null and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'Say why it is kept' using errcode = 'check_violation';
  end if;
  update patients set retention_kept_until = p_until, retention_kept_reason = nullif(trim(p_reason), '') where id = p_patient_id;
end;
$$;
revoke all on function public.keep_patient_record(uuid, date, text) from public, anon;
grant execute on function public.keep_patient_record(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- The audit trail lets anonymize_patient blank this patient's snapshots
-- ---------------------------------------------------------------------
create or replace function public.audit_logs_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' and not exists (select 1 from public.accounts a where a.id = OLD.account_id) then
    return OLD;
  end if;
  if TG_OP = 'UPDATE'
     and NEW.team_member_id is null
     and (to_jsonb(NEW) - 'team_member_id') = (to_jsonb(OLD) - 'team_member_id') then
    return NEW;
  end if;
  -- anonymize_patient, for the one patient it is anonymising: the content
  -- may be blanked, nothing else about the row may change.
  if TG_OP = 'UPDATE'
     and OLD.patient_id is not null
     and current_setting('quiroflow.anonymizing_patient', true) = OLD.patient_id::text
     and (to_jsonb(NEW) - 'snapshot' - 'changes' - 'summary') = (to_jsonb(OLD) - 'snapshot' - 'changes' - 'summary') then
    return NEW;
  end if;
  raise exception '% is append-only', TG_TABLE_NAME using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function public.audit_logs_are_append_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Anonymise
-- ---------------------------------------------------------------------
create or replace function public.anonymize_patient(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient patients%rowtype;
  v_years int;
  v_last timestamptz;
  v_files text[];
  v_photo text;
  v_appts uuid[];
  v_actor_name text;
begin
  select * into v_patient from patients where id = p_patient_id for update;
  if v_patient.id is null or not public.is_account_owner(v_patient.account_id) then
    raise exception 'Only an owner can anonymise a record' using errcode = 'insufficient_privilege';
  end if;
  if v_patient.anonymized_at is not null then
    raise exception 'This record is already anonymised' using errcode = 'check_violation';
  end if;
  select clinical_retention_years into v_years from accounts where id = v_patient.account_id;
  v_last := public.patient_last_activity(p_patient_id);
  if v_last >= now() - make_interval(years => v_years) then
    raise exception 'This record is still inside its retention period' using errcode = 'check_violation';
  end if;
  if v_patient.retention_kept_until is not null and v_patient.retention_kept_until >= current_date then
    raise exception 'This record is being kept until %', v_patient.retention_kept_until using errcode = 'check_violation';
  end if;

  perform set_config('quiroflow.anonymizing_patient', p_patient_id::text, true);

  select array_agg(id) into v_appts from appointments where patient_id = p_patient_id;
  select array_agg(storage_path) filter (where storage_path is not null) into v_files from patient_files where patient_id = p_patient_id;
  v_photo := v_patient.photo_storage_path;

  -- The clinical record.
  delete from visit_notes where appointment_id = any(coalesce(v_appts, '{}'));
  delete from visit_listings where appointment_id = any(coalesce(v_appts, '{}'));
  delete from visit_pain_scores where appointment_id = any(coalesce(v_appts, '{}'));
  delete from satisfaction_surveys where appointment_id = any(coalesce(v_appts, '{}'));
  update appointments set note = null where patient_id = p_patient_id and note is not null;
  delete from patient_files where patient_id = p_patient_id;
  delete from patient_docs where patient_id = p_patient_id;
  delete from patient_exercises where patient_id = p_patient_id;
  if to_regclass('public.learn_sends') is not null then
    execute 'delete from public.learn_sends where patient_id = $1' using p_patient_id;
  end if;
  delete from staff_tasks where patient_id = p_patient_id;

  -- What was said to and by them, and how to reach them.
  delete from patient_app_messages where patient_id = p_patient_id;
  delete from whatsapp_messages where patient_id = p_patient_id;
  delete from email_messages where patient_id = p_patient_id;
  delete from contact_log where patient_id = p_patient_id;
  delete from patient_push_log where patient_id = p_patient_id;
  delete from patient_contact_numbers where patient_id = p_patient_id;
  delete from photo_upload_tokens where patient_id = p_patient_id;
  delete from waitlist_entries where patient_id = p_patient_id;
  delete from review_requests where patient_id = p_patient_id;
  delete from automation_sequence_runs where patient_id = p_patient_id;
  delete from automation_birthday_sends where patient_id = p_patient_id;
  delete from leads where patient_id = p_patient_id;

  -- The person. What stays is a nameless row the money and the visits hang on.
  update patients set
    first_name = 'Paciente',
    last_name = 'anonimizado',
    date_of_birth = null, email = null, occupation = null, emergency_contact = null,
    notes = null, sticky_note = null, address = null, postal_code = null, city = null, country = null,
    national_id = null, gender = null, external_reference = null, photo_storage_path = null,
    chief_complaint = null, diagnosis = null, red_flags = null, yellow_flags = null, goals = null,
    tags = '{}', user_id = null, has_phone = false, do_not_contact = true,
    marketing_channels = '{}', referral_code = null, status = 'inactive',
    retention_kept_until = null, retention_kept_reason = null,
    anonymized_at = now()
  where id = p_patient_id;

  -- The trail keeps who did what and when, not what the record said.
  update audit_logs
  set snapshot = null,
      changes = case when entity_type in ('payment', 'invoice', 'account_credit') then changes else null end,
      summary = case when entity_type in ('payment', 'invoice', 'account_credit') then summary else 'Datos anonimizados' end
  where patient_id = p_patient_id and account_id = v_patient.account_id
    and (snapshot is not null or changes is not null);

  select full_name into v_actor_name from team_members where account_id = v_patient.account_id and user_id = auth.uid() and deleted_at is null limit 1;
  insert into audit_logs (account_id, entity_type, entity_id, action, summary, actor, actor_name, patient_id, team_member_id)
  values (v_patient.account_id, 'patient', p_patient_id, 'updated', 'Historia anonimizada por plazo de conservación cumplido', 'staff', v_actor_name, p_patient_id,
    (select id from team_members where account_id = v_patient.account_id and user_id = auth.uid() and deleted_at is null limit 1));

  -- Closed again at once: nothing later in the same transaction may blank anything.
  perform set_config('quiroflow.anonymizing_patient', '', true);
  return jsonb_build_object('files', coalesce(to_jsonb(v_files), '[]'::jsonb), 'photo', v_photo);
end;
$$;
revoke all on function public.anonymize_patient(uuid) from public, anon;
grant execute on function public.anonymize_patient(uuid) to authenticated;
