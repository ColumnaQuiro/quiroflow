-- Family accounts: one patient login manages their family.
--
-- A parent books, pays, checks in and sees exercises or documents for their
-- children -- or a partner books for a partner -- from their own login,
-- switching between people in the app and the web portal. Until now a login
-- reached exactly its own record: about twenty-five patient-side policies and
-- twenty RPCs resolved "me" as `patients.user_id = auth.uid()`.
--
-- WHO MAY ACT FOR WHOM is an explicit link the desk records (patient_managers),
-- never inferred: not every family edge (a sibling or an adult child must not
-- read another adult's clinical record), not the minor's tutor field (that
-- would switch access on the moment this is applied, before the screens that
-- explain it ship), and never a shared email.
--
--   basis  'guardian'  the parent or legal guardian of a minor. Lapses by
--                      itself at 16, the age of medical consent (Ley 41/2002,
--                      art. 9), read from date_of_birth at query time; with
--                      no date of birth, only while is_minor is set. From 16
--                      the desk records the young person's own consent.
--          'consent'   an adult who agreed; `note` says how and when.
--   access 'full'      everything the person sees themselves.
--          'admin'     visits, booking, check-in, payments, bonos, invoices.
--                      No documents, exercises, posture, care plan, learn
--                      content, habits, pain scores or messages.
--
-- HOW THE ACTIVE PERSON TRAVELS: the client says whose screen it is showing,
-- and the database decides whether it may. Two functions return the set:
--   patients_i_can_act_for()             my own rows and every valid link
--   patients_i_can_see_clinically_for()  my own rows and the 'full' links
-- Every patient-side policy reads one of them instead of user_id = auth.uid(),
-- and the RPCs that resolved "me" take an optional p_patient_id checked
-- against them -- null is my own record, which is what the live app sends.
-- A forged id for somebody outside the set gets what it gets today: nothing.
--
-- Until links exist (the desk's screen ships with the release), both sets are
-- exactly today's own rows, so this is backwards-compatible with what is live.

-- ---------------------------------------------------------------------------
-- 1. The links
-- ---------------------------------------------------------------------------
create table public.patient_managers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  manager_patient_id uuid not null references public.patients(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  basis text not null check (basis in ('guardian', 'consent')),
  access text not null default 'full' check (access in ('full', 'admin')),
  note text,
  granted_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_managers_not_self check (manager_patient_id <> patient_id),
  constraint patient_managers_pair unique (manager_patient_id, patient_id)
);
create index patient_managers_patient_idx on public.patient_managers (patient_id);
select public.grant_data_api('public.patient_managers');

comment on table public.patient_managers is
  'Who may act for whom in the patient app and portal: manager_patient_id''s login sees and acts for patient_id. Set by the desk; read by patients_i_can_act_for().';

-- A guardian link only stands while the person is under 16. Stable, not
-- immutable: it reads current_date.
create or replace function public.patient_is_guardian_age(p_date_of_birth date, p_is_minor boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_date_of_birth is not null then p_date_of_birth > (current_date - interval '16 years')::date
    else coalesce(p_is_minor, false)
  end;
$$;

-- Both people this clinic's, the manager an adult, and a guardian link only
-- for somebody it can still stand for. Said in Spanish: the desk reads it.
create or replace function public.patient_managers_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager public.patients%rowtype;
  v_patient public.patients%rowtype;
begin
  select * into v_manager from public.patients where id = new.manager_patient_id;
  select * into v_patient from public.patients where id = new.patient_id;
  if v_manager.account_id is distinct from new.account_id or v_patient.account_id is distinct from new.account_id then
    raise exception 'Las dos fichas tienen que ser de esta clínica' using errcode = 'check_violation';
  end if;
  if v_manager.anonymized_at is not null or v_patient.anonymized_at is not null then
    raise exception 'Una de las fichas está anonimizada' using errcode = 'check_violation';
  end if;
  if v_manager.is_minor or (v_manager.date_of_birth is not null and v_manager.date_of_birth > (current_date - interval '18 years')::date) then
    raise exception 'Quien gestiona la cuenta tiene que ser mayor de edad' using errcode = 'check_violation';
  end if;
  if new.basis = 'guardian' and not public.patient_is_guardian_age(v_patient.date_of_birth, v_patient.is_minor) then
    raise exception 'Desde los 16 años hace falta su consentimiento: elige "Con su consentimiento"' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger patient_managers_check before insert or update on public.patient_managers
  for each row execute function public.patient_managers_check();

alter table public.patient_managers enable row level security;

-- Staff: who may see a link is who may see the record it gives access to;
-- granting is editing that patient.
create policy "staff select patient_managers" on public.patient_managers for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));
create policy "staff insert patient_managers" on public.patient_managers for insert
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit')
    and public.can_access_patient(account_id, patient_id) and public.can_access_patient(account_id, manager_patient_id)
  );
create policy "staff update patient_managers" on public.patient_managers for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit') and public.can_access_patient(account_id, patient_id))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit') and public.can_access_patient(account_id, patient_id));
create policy "staff delete patient_managers" on public.patient_managers for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'patients_edit') and public.can_access_patient(account_id, patient_id));
-- Patients read and withdraw links through get_my_family / get_my_managers /
-- withdraw_patient_manager below, not the table.
select public.require_two_factor_on('public.patient_managers');

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
  'account', 'account_credit', 'api_token', 'appointment', 'appointment_type', 'care_stop', 'care_stop_reason',
  'cash_movement', 'cash_shift', 'check_in_portal', 'clinic', 'email_template', 'exercise_schedule', 'habit_checkin',
  'invite', 'invoice', 'letter_template', 'membership', 'package', 'package_purchase', 'patient', 'patient_attribute',
  'patient_attribute_value', 'patient_doc', 'patient_file', 'patient_letter', 'patient_list', 'patient_list_member',
  'patient_membership', 'patient_relation', 'patient_segment', 'patient_third_party', 'payment', 'recall_assignment',
  'receptionist_settings', 'role', 'service', 'team_member', 'team_member_clinic', 'third_party',
  'third_party_allocation', 'third_party_charge', 'third_party_payment', 'third_party_rate', 'verifactu_certificate',
  'verifactu_delegation', 'visit_note', 'webhook', 'patient_manager'
]));
create trigger trg_audit_patient_managers after insert or update or delete on public.patient_managers
  for each row execute function public.fn_audit_log('patient_manager', 'updated_at');

-- Anonymising a record takes its links with it, both directions.
create or replace function public.patients_drop_managers_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_managers where patient_id = new.id or manager_patient_id = new.id;
  end if;
  return new;
end;
$$;
create trigger patients_drop_managers_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_managers_on_anonymize();

-- ---------------------------------------------------------------------------
-- 2. The two sets
-- ---------------------------------------------------------------------------
-- No arguments, so the planner evaluates each once per query and hashes it,
-- as my_own_patient_ids() (0142) does. SECURITY DEFINER so reading patients
-- here does not recurse into patients' own policies.
create or replace function public.patients_i_can_act_for()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.patients p where p.user_id = (select auth.uid())
  union
  select m.patient_id
  from public.patient_managers m
  join public.patients me on me.id = m.manager_patient_id
  join public.patients p on p.id = m.patient_id and p.account_id = m.account_id
  where me.user_id = (select auth.uid())
    and me.anonymized_at is null and p.anonymized_at is null
    and (m.basis = 'consent' or public.patient_is_guardian_age(p.date_of_birth, p.is_minor));
$$;

create or replace function public.patients_i_can_see_clinically_for()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.patients p where p.user_id = (select auth.uid())
  union
  select m.patient_id
  from public.patient_managers m
  join public.patients me on me.id = m.manager_patient_id
  join public.patients p on p.id = m.patient_id and p.account_id = m.account_id
  where me.user_id = (select auth.uid())
    and m.access = 'full'
    and me.anonymized_at is null and p.anonymized_at is null
    and (m.basis = 'consent' or public.patient_is_guardian_age(p.date_of_birth, p.is_minor));
$$;

revoke all on function public.patients_i_can_act_for() from public, anon;
revoke all on function public.patients_i_can_see_clinically_for() from public, anon;
grant execute on function public.patients_i_can_act_for() to authenticated, service_role;
grant execute on function public.patients_i_can_see_clinically_for() to authenticated, service_role;

-- The record an RPC acts on: my own when p_patient_id is null (the oldest, as
-- `select ... into` from several rows effectively did), otherwise the one
-- named, if it is in the set. p_clinical picks which set.
create or replace function public.acting_patient(p_patient_id uuid, p_clinical boolean default false)
returns table (id uuid, account_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.account_id
  from public.patients p
  where case
    when p_patient_id is null then p.user_id = (select auth.uid())
    when p_clinical then p.id = p_patient_id and p.id in (select public.patients_i_can_see_clinically_for())
    else p.id = p_patient_id and p.id in (select public.patients_i_can_act_for())
  end
  order by p.created_at
  limit 1;
$$;
revoke all on function public.acting_patient(uuid, boolean) from public, anon;
grant execute on function public.acting_patient(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Patient-side policies
-- ---------------------------------------------------------------------------
-- Money, visits and the person's own details: any valid link.
alter policy "patients view own record" on public.patients
  using (id in (select public.patients_i_can_act_for()));
alter policy "patients view own appointments" on public.appointments
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients read types of own appointments" on public.appointment_types
  using (exists (select 1 from public.appointments a
                 where a.appointment_type_id = appointment_types.id
                   and a.patient_id in (select public.patients_i_can_act_for())));
alter policy "patients read practitioners of own appointments" on public.team_members
  using (exists (select 1 from public.appointments a
                 where a.practitioner_id = team_members.id
                   and a.patient_id in (select public.patients_i_can_act_for())));
alter policy "patients view own account_credits" on public.account_credits
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own invoices" on public.invoices
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own invoice_line_items" on public.invoice_line_items
  using (invoice_id in (select i.id from public.invoices i where i.patient_id in (select public.patients_i_can_act_for())));
alter policy "patients view own payments" on public.payments
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own facturas" on public.facturas
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own package_purchases" on public.package_purchases
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own package_sessions" on public.package_sessions
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own patient_memberships" on public.patient_memberships
  using (patient_id in (select public.patients_i_can_act_for()));
alter policy "patients view own contact numbers" on public.patient_contact_numbers
  using (patient_id in (select public.patients_i_can_act_for()));

-- Clinical content: own record and 'full' links only.
alter policy "patients view own care_plans" on public.care_plans
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients view own patient_exercises" on public.patient_exercises
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients view own patient_exercise_logs" on public.patient_exercise_logs
  using (patient_exercise_id in (select pe.id from public.patient_exercises pe
                                 where pe.patient_id in (select public.patients_i_can_see_clinically_for())));
alter policy "patients view own custom patient_files" on public.patient_files
  using (visibility = 'custom' and storage_path is not null
         and patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients view own shared posture_assessments" on public.posture_assessments
  using (shared_with_patient and patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients view own learn_sends" on public.learn_sends
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients view their clinic's public articles" on public.learn_articles
  using (visible_to_patients and archived_at is null
         and account_id in (select p.account_id from public.patients p
                            where p.id in (select public.patients_i_can_see_clinically_for())));
alter policy "patients view own habit_checkins" on public.habit_checkins
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients delete own habit_checkins" on public.habit_checkins
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patients add own habit_checkins" on public.habit_checkins
  with check (
    patient_id in (select p.id from public.patients p
                   where p.id in (select public.patients_i_can_see_clinically_for())
                     and p.account_id = habit_checkins.account_id)
    and done_at <= now() + interval '5 minutes'
    and done_at > now() - interval '3 days'
  );
alter policy "patient select own patient_app_messages" on public.patient_app_messages
  using (patient_id in (select public.patients_i_can_see_clinically_for()));
alter policy "patient insert own patient_app_messages" on public.patient_app_messages
  with check (direction = 'inbound' and patient_id in (select public.patients_i_can_see_clinically_for()));

-- Who wrote an inbound message, when it was not the patient: the desk reads
-- "Enviado por María (madre)". Stamped here so no client can claim another
-- sender; null for the patient themselves and for every outbound message.
-- No foreign key, deliberately: a second relationship from this table to
-- patients would make every existing patients(...) embed of it ambiguous
-- (PGRST201). merge_patients moves it; a deleted sender leaves a dangling id
-- that names nobody, as audit_logs.patient_id does.
alter table public.patient_app_messages add column sent_by_patient_id uuid;
create or replace function public.patient_app_messages_stamp_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
begin
  new.sent_by_patient_id := null;
  if new.direction = 'inbound' and (select auth.uid()) is not null then
    select p.id into v_me from public.patients p
    where p.user_id = (select auth.uid()) and p.account_id = new.account_id
    order by p.created_at limit 1;
    if v_me is not null and v_me <> new.patient_id then
      new.sent_by_patient_id := v_me;
    end if;
  end if;
  return new;
end;
$$;
create trigger patient_app_messages_stamp_sender before insert on public.patient_app_messages
  for each row execute function public.patient_app_messages_stamp_sender();

-- ---------------------------------------------------------------------------
-- 4. Patient RPCs: restated from their latest definitions with only the
--    ownership test changed (and p_patient_id where they resolved "me").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_patient_appointment(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_patient_id uuid;
  v_account_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_checked_in_at timestamptz;
  v_enabled boolean;
  v_notice_hours int;
begin
  -- The visit's own patient, when it is somebody this login may act for
  -- (patients_i_can_act_for, 20261106053857); before, the caller's own record.
  select a.patient_id, a.account_id into v_patient_id, v_account_id
  from appointments a
  where a.id = p_appointment_id and a.deleted_at is null
    and a.patient_id in (select public.patients_i_can_act_for());
  if v_patient_id is null then
    raise exception 'Appointment not found';
  end if;

  select patient_app_cancel_enabled, patient_app_change_notice_hours
    into v_enabled, v_notice_hours
  from accounts where id = v_account_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Cancelling from the app is not enabled for this clinic';
  end if;

  select starts_at, status, checked_in_at into v_starts_at, v_status, v_checked_in_at
  from appointments
  where id = p_appointment_id and patient_id = v_patient_id and deleted_at is null;
  if v_starts_at is null then
    raise exception 'Appointment not found';
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('appointment_id', p_appointment_id, 'already_cancelled', true);
  end if;

  -- A visit that happened is a clinical record, not a plan -- cancelling it
  -- would erase what took place. status only ever holds booked/completed/
  -- cancelled/no_show (appointments_status_check), and a visit in progress
  -- is still 'booked' with checked_in_at set, so both are checked.
  if v_status in ('completed', 'no_show') or v_checked_in_at is not null then
    raise exception 'This appointment can no longer be changed';
  end if;

  if v_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Too close to the appointment -- please contact the clinic';
  end if;

  update appointments
  set status = 'cancelled'
  where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'cancelled', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_patient_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_patient_id uuid;
  v_account_id uuid;
  v_enabled boolean;
  v_notice_hours int;
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status text;
  v_checked_in_at timestamptz;
  v_practitioner_id uuid;
  v_clinic_id uuid;
  v_appointment_type_id uuid;
  v_duration interval;
  v_new_ends_at timestamptz;
  v_room_id uuid;
begin
  -- The visit's own patient, when it is somebody this login may act for
  -- (patients_i_can_act_for, 20261106053857); before, the caller's own record.
  select a.patient_id, a.account_id into v_patient_id, v_account_id
  from appointments a
  where a.id = p_appointment_id and a.deleted_at is null
    and a.patient_id in (select public.patients_i_can_act_for());
  if v_patient_id is null then
    raise exception 'Appointment not found';
  end if;

  select patient_app_reschedule_enabled, patient_app_change_notice_hours, online_booking_max_days_ahead
    into v_enabled, v_notice_hours, v_max_days_ahead
  from accounts where id = v_account_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Rescheduling from the app is not enabled for this clinic';
  end if;

  select starts_at, ends_at, status, checked_in_at, practitioner_id, clinic_id, appointment_type_id
    into v_starts_at, v_ends_at, v_status, v_checked_in_at, v_practitioner_id, v_clinic_id, v_appointment_type_id
  from appointments
  where id = p_appointment_id and patient_id = v_patient_id and deleted_at is null;
  if v_starts_at is null then
    raise exception 'Appointment not found';
  end if;
  if v_status in ('completed', 'no_show', 'cancelled') or v_checked_in_at is not null then
    raise exception 'This appointment can no longer be changed';
  end if;

  -- Moving a visit books its practitioner at the new time, so it cannot be
  -- somebody who has left: they would never turn up. The visit they left
  -- behind is the clinic's to hand to somebody else.
  if v_practitioner_id is not null and exists (
    select 1 from team_members where id = v_practitioner_id and deleted_at is not null
  ) then
    raise exception 'Practitioner not available';
  end if;

  -- The notice window applies to BOTH ends: a patient cannot move a visit
  -- that is hours away (the slot can no longer be refilled), and cannot
  -- move one INTO that window either, which would otherwise be a way to
  -- get the same effect in two steps.
  if v_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Too close to the appointment -- please contact the clinic';
  end if;
  if p_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Please choose a time further ahead, or contact the clinic';
  end if;

  -- How far ahead, as create_patient_booking checks it: the appointment's
  -- own type's horizon, else the clinic's.
  select online_max_days_ahead into v_type_max_days_ahead
  from appointment_types where id = v_appointment_type_id;
  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
  end if;

  v_duration := v_ends_at - v_starts_at;
  v_new_ends_at := p_starts_at + v_duration;

  -- Inside the hours the practitioner works and clear of every closure, as a
  -- new booking is.
  perform public.assert_booking_slot_open(v_clinic_id, v_practitioner_id, p_starts_at, v_new_ends_at);

  -- One booking at a time per practitioner. The overlap check below and the
  -- insert after it are two statements, and two patients picking the same
  -- free slot a moment apart both passed the check before either insert was
  -- visible, so both got the appointment. The lock is held to the end of the
  -- transaction, so whoever takes it second re-runs the check against the
  -- first one's committed row and is refused. Same key in create_public_booking,
  -- create_patient_booking and reschedule_patient_appointment.
  perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(coalesce(v_practitioner_id, v_clinic_id)::text));

  if exists (
    select 1 from appointments
    where practitioner_id = v_practitioner_id
      and id <> p_appointment_id
      and status <> 'cancelled'
      and deleted_at is null
      and starts_at < v_new_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  -- The old room may be taken at the new time; re-pick rather than
  -- carrying a booking into an occupied room.
  select cr.id into v_room_id
  from calendar_resources cr
  where cr.clinic_id = v_clinic_id
    and not exists (
      select 1 from appointments a
      where a.room_id = cr.id
        and a.id <> p_appointment_id
        and a.status <> 'cancelled'
        and a.deleted_at is null
        and a.starts_at < v_new_ends_at
        and a.ends_at > p_starts_at
    )
  order by cr.name
  limit 1;

  -- rescheduled = true is what the staff calendar reads to show the row as
  -- moved. Unlike the bulk PracticeHub re-sync (which moves times silently
  -- on purpose), a patient moving their own appointment is exactly the
  -- case the flag exists to surface.
  update appointments
  set starts_at = p_starts_at,
      ends_at = v_new_ends_at,
      room_id = v_room_id,
      rescheduled = true
  where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'starts_at', p_starts_at, 'ends_at', v_new_ends_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_in_my_appointment(p_appointment_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_at timestamptz;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  update public.appointments a
  set checked_in_at = coalesce(a.checked_in_at, now())
  from public.patients p
  where a.id = p_appointment_id
    and p.id = a.patient_id
    and p.id in (select public.patients_i_can_act_for())
    and a.status = 'booked'
    and a.deleted_at is null
    and now() >= a.starts_at - interval '90 minutes'
    and now() <= a.ends_at
  returning a.checked_in_at into v_at;
  return v_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_my_appointment(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  update public.appointments a
  set confirmation_status = 'confirmed'
  from public.patients p
  where a.id = p_appointment_id
    and p.id = a.patient_id
    and p.id in (select public.patients_i_can_act_for())
    and a.status = 'booked'
    and a.deleted_at is null
    and a.starts_at > now()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$function$;

drop function public.create_patient_booking(uuid, uuid, uuid, timestamp with time zone, text);
CREATE OR REPLACE FUNCTION public.create_patient_booking(p_clinic_id uuid, p_team_member_id uuid, p_appointment_type_id uuid, p_starts_at timestamp with time zone, p_note text, p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_duration int;
  v_override_duration int;
  v_type_price int;
  v_override_price int;
  v_effective_price int;
  v_payment_required boolean;
  v_bookable_by text;
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_deposit_cents int;
  v_bypass_practitioner boolean;
  v_assigned_practitioner uuid;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_room_id uuid;
begin
  -- p_patient_id: who the visit is for -- my own record when null, or somebody
  -- I may act for (acting_patient, 20261106053857).
  select r.id, r.account_id into v_patient_id, v_account_id from public.acting_patient(p_patient_id) r;
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  -- The gate 0162 added.
  if not exists (select 1 from accounts where id = v_account_id and patient_app_booking_enabled = true) then
    raise exception 'Booking from the app is not enabled for this clinic';
  end if;

  select online_booking_max_days_ahead into v_max_days_ahead from accounts where id = v_account_id;

  if not exists (
    select 1 from clinics
    where id = p_clinic_id and account_id = v_account_id and online_booking_enabled = true
  ) then
    raise exception 'Clinic not available for online booking';
  end if;

  select duration_minutes, default_price_cents, online_payment_required,
         online_bookable_by, online_max_days_ahead, online_deposit_cents,
         online_bypass_practitioner
    into v_duration, v_type_price, v_payment_required,
         v_bookable_by, v_type_max_days_ahead, v_deposit_cents,
         v_bypass_practitioner
  from appointment_types
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true
    and archived_at is null;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  -- Who may book it, as create_public_booking decides it: a patient record
  -- already exists (it is the one this booking is for), so this is never a
  -- new patient, and 'existing_patients' always passes.
  if v_bookable_by = 'new_patients' then
    raise exception 'This appointment type is only available to new patients';
  end if;

  -- How far ahead, as create_public_booking checks it.
  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
  end if;

  -- The practitioner's own length and price for this type, as
  -- create_public_booking has applied them since 0072.
  select duration_minutes, price_cents into v_override_duration, v_override_price
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
  end if;
  v_effective_price := coalesce(v_override_price, v_type_price);

  -- The web page would charge for this booking; the app cannot take the
  -- payment, so it does not book it unpaid.
  if v_payment_required and v_effective_price > 0 and coalesce(v_deposit_cents, v_effective_price) > 0 then
    raise exception 'This appointment type has to be paid online when booking, which the app cannot do yet. Book it on the clinic''s booking page or contact the clinic.';
  end if;

  -- Somebody who sees patients, as create_public_booking requires, and who
  -- is still with the clinic.
  if not exists (
    select 1 from team_members tm
    join team_member_clinics tmc on tmc.team_member_id = tm.id
    where tm.id = p_team_member_id and tm.account_id = v_account_id
      and tm.online_booking_enabled = true and tm.is_practitioner = true and tm.deleted_at is null
      and tmc.clinic_id = p_clinic_id
  ) then
    raise exception 'Practitioner not available';
  end if;

  -- "Patient doesn't choose a practitioner": the one the web page would
  -- book, and nobody else. Named, so an app that still shows a picker can
  -- be answered by choosing them.
  if v_bypass_practitioner then
    v_assigned_practitioner := public.patient_app_assigned_practitioner(v_account_id, p_clinic_id);
    if p_team_member_id is distinct from v_assigned_practitioner then
      raise exception 'For this appointment type the clinic assigns the practitioner: please choose %',
        (select full_name from team_members where id = v_assigned_practitioner);
    end if;
  end if;

  if p_starts_at < now() then
    raise exception 'Cannot book a time in the past';
  end if;

  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  -- Inside the hours this practitioner works and clear of every closure, as
  -- create_public_booking checks it. The app offered a practitioner's days
  -- off and blocked time, and this booked them.
  perform public.assert_booking_slot_open(p_clinic_id, p_team_member_id, p_starts_at, v_ends_at);

  -- One booking at a time per practitioner. The overlap check below and the
  -- insert after it are two statements, and two patients picking the same
  -- free slot a moment apart both passed the check before either insert was
  -- visible, so both got the appointment. The lock is held to the end of the
  -- transaction, so whoever takes it second re-runs the check against the
  -- first one's committed row and is refused. Same key in create_public_booking,
  -- create_patient_booking and reschedule_patient_appointment.
  perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(p_team_member_id::text));

  if exists (
    select 1 from appointments
    where practitioner_id = p_team_member_id
      and status <> 'cancelled'
      -- A deleted appointment keeps status 'booked'; it holds no time.
      and deleted_at is null
      and starts_at < v_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  select cr.id into v_room_id
  from calendar_resources cr
  where cr.clinic_id = p_clinic_id
    and not exists (
      select 1 from appointments a
      where a.room_id = cr.id
        and a.status <> 'cancelled'
        and a.deleted_at is null
        and a.starts_at < v_ends_at
        and a.ends_at > p_starts_at
    )
  order by cr.name
  limit 1;

  insert into appointments (
    account_id, clinic_id, room_id, practitioner_id, patient_id, appointment_type_id,
    starts_at, ends_at, status, source
  )
  values (
    v_account_id, p_clinic_id, v_room_id, p_team_member_id, v_patient_id, p_appointment_type_id,
    p_starts_at, v_ends_at, 'booked', 'online'
  )
  returning id into v_appointment_id;

  if p_note is not null and trim(p_note) <> '' then
    insert into visit_notes (account_id, appointment_id, body, created_by)
    values (v_account_id, v_appointment_id, trim(p_note), null);
  end if;

  return jsonb_build_object('appointment_id', v_appointment_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at);
end;
$function$;
revoke all on function public.create_patient_booking(uuid, uuid, uuid, timestamp with time zone, text, uuid) from public, anon;
grant execute on function public.create_patient_booking(uuid, uuid, uuid, timestamp with time zone, text, uuid) to authenticated, service_role;

drop function public.get_patient_booking_info();
CREATE OR REPLACE FUNCTION public.get_patient_booking_info(p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
begin
  select r.account_id into v_account_id from public.acting_patient(p_patient_id) r;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  return jsonb_build_object(
    'settings', (
      select jsonb_build_object(
        'booking_enabled', a.patient_app_booking_enabled,
        'cancel_enabled', a.patient_app_cancel_enabled,
        'reschedule_enabled', a.patient_app_reschedule_enabled,
        'change_notice_hours', a.patient_app_change_notice_hours,
        'clinic_name', a.name,
        -- The clinic's default booking horizon, for a type that sets none.
        'max_days_ahead', a.online_booking_max_days_ahead,
        -- For the link to /book/<slug>, where a type needing payment can be
        -- booked and paid.
        'booking_slug', a.slug
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'timezone', c.timezone
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_max_days_ahead', at.online_max_days_ahead,
        -- The patient does not choose: booked with the first practitioner
        -- below who works at the chosen clinic.
        'online_bypass_practitioner', at.online_bypass_practitioner
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
        -- An app user always has a patient record: never a new patient.
        and at.online_bookable_by <> 'new_patients'
        and not public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'online_payment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name,
        'default_price_cents', at.default_price_cents,
        'online_deposit_cents', at.online_deposit_cents
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
        and at.online_bookable_by <> 'new_patients'
        and public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color,
        -- The practitioner's own week, which decides their slots on the web
        -- page (practitionerWindowsForDay). Without it the app offered the
        -- clinic's hours on a practitioner's days off.
        'business_hours', tm.business_hours,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        -- The web page's order, and patient_app_assigned_practitioner's.
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at, tm.id)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true
        and tm.is_practitioner = true and tm.deleted_at is null
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.get_patient_booking_info(uuid) from public, anon;
grant execute on function public.get_patient_booking_info(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_clinic_timezones()
 RETURNS TABLE(clinic_id uuid, timezone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.timezone
  from public.clinics c
  where c.account_id in (select p.account_id from public.patients p where p.id in (select public.patients_i_can_act_for()))
    and nullif(c.timezone, '') is not null
    and public.mfa_satisfied()
$function$;

CREATE OR REPLACE FUNCTION public.get_my_clinics()
 RETURNS TABLE(id uuid, name text, address text, phone text, timezone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.name, c.address, c.phone, c.timezone
  from public.clinics c
  where c.account_id in (select p.account_id from public.patients p where p.id in (select public.patients_i_can_act_for()))
    and c.archived_at is null
    and public.mfa_satisfied()
  order by c.name
$function$;

CREATE OR REPLACE FUNCTION public.get_my_shared_packages(p_patient_id uuid)
 RETURNS TABLE(id uuid, package_name text, sessions_total integer, sessions_used integer, price_cents integer, is_closed boolean, owner_first_name text, owner_last_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pp.id, pp.package_name, pp.sessions_total, pp.sessions_used, pp.price_cents, pp.is_closed,
         owner.first_name, owner.last_name
  from public.package_purchase_shares s
  join public.package_purchases pp on pp.id = s.package_purchase_id and pp.account_id = s.account_id
  join public.patients owner on owner.id = pp.patient_id
  where s.patient_id = p_patient_id
    and exists (select 1 from public.patients me where me.id = p_patient_id and me.id in (select public.patients_i_can_act_for()))
    and public.mfa_satisfied()
$function$;

drop function public.get_my_waitlist();
CREATE OR REPLACE FUNCTION public.get_my_waitlist(p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, clinic_id uuid, status text, created_at timestamp with time zone, offered_starts_at timestamp with time zone, offer_expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select w.id, w.clinic_id, w.status, w.created_at, w.offered_starts_at, w.offer_expires_at
  from public.waitlist_entries w
  join public.patients p on p.id = w.patient_id
  where (case when p_patient_id is null then p.user_id = auth.uid() else p.id = p_patient_id and p.id in (select public.patients_i_can_act_for()) end)
    and w.status in ('waiting', 'offered')
    and public.mfa_satisfied()
  order by w.created_at
$function$;
revoke all on function public.get_my_waitlist(uuid) from public, anon;
grant execute on function public.get_my_waitlist(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_own_patient_account(target_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from patients p
    where p.account_id = target_account_id
      and p.id in (select public.patients_i_can_act_for())
  );
$function$;

drop function public.join_my_waitlist(uuid);
CREATE OR REPLACE FUNCTION public.join_my_waitlist(p_clinic_id uuid, p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_entry_id uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;

  select c.account_id into v_account_id
  from public.clinics c
  join public.accounts a on a.id = c.account_id
  where c.id = p_clinic_id and c.archived_at is null and a.patient_app_booking_enabled = true;
  if v_account_id is null then
    raise exception 'This clinic does not take waitlist requests from the app';
  end if;

  select p.id into v_patient_id
  from public.patients p
  where p.account_id = v_account_id and (case when p_patient_id is null then p.user_id = auth.uid() else p.id = p_patient_id and p.id in (select public.patients_i_can_act_for()) end)
  limit 1;
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  select w.id into v_entry_id
  from public.waitlist_entries w
  where w.patient_id = v_patient_id and w.clinic_id = p_clinic_id and w.status in ('waiting', 'offered')
  limit 1;
  if v_entry_id is not null then
    return v_entry_id;
  end if;

  insert into public.waitlist_entries (account_id, clinic_id, patient_id, status, source)
  values (v_account_id, p_clinic_id, v_patient_id, 'waiting', 'patient')
  returning id into v_entry_id;
  return v_entry_id;
end;
$function$;
revoke all on function public.join_my_waitlist(uuid, uuid) from public, anon;
grant execute on function public.join_my_waitlist(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_my_waitlist(p_entry_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  update public.waitlist_entries w
  set status = 'cancelled'
  from public.patients p
  where w.id = p_entry_id and p.id = w.patient_id and p.id in (select public.patients_i_can_act_for()) and w.status = 'waiting'
  returning true into v_found;
  return coalesce(v_found, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_assigned_exercise_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pe.exercise_id from public.patient_exercises pe
  join public.patients p on p.id = pe.patient_id
  where p.id in (select public.patients_i_can_see_clinically_for())
$function$;

CREATE OR REPLACE FUNCTION public.my_sent_learn_article_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.article_id from public.learn_sends s
  join public.patients p on p.id = s.patient_id
  where p.id in (select public.patients_i_can_see_clinically_for())
$function$;

CREATE OR REPLACE FUNCTION public.my_pain_context(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient uuid;
  v_starts timestamptz;
  v_today smallint;
  v_previous smallint;
  v_first smallint;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  select a.patient_id, a.starts_at into v_patient, v_starts
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.id = p_appointment_id and p.id in (select public.patients_i_can_see_clinically_for()) and a.deleted_at is null;
  if v_patient is null then
    return null;
  end if;
  select s.patient_score into v_today from public.visit_pain_scores s where s.appointment_id = p_appointment_id;
  select coalesce(s.practitioner_score, s.patient_score) into v_previous
  from public.visit_pain_scores s
  join public.appointments a on a.id = s.appointment_id
  where a.patient_id = v_patient and a.starts_at < v_starts and a.deleted_at is null
    and coalesce(s.practitioner_score, s.patient_score) is not null
  order by a.starts_at desc limit 1;
  select coalesce(s.practitioner_score, s.patient_score) into v_first
  from public.visit_pain_scores s
  join public.appointments a on a.id = s.appointment_id
  where a.patient_id = v_patient and a.starts_at < v_starts and a.deleted_at is null
    and coalesce(s.practitioner_score, s.patient_score) is not null
  order by a.starts_at asc limit 1;
  return jsonb_build_object('today', v_today, 'previous', v_previous, 'first', v_first);
end;
$function$;

drop function public.my_pain_trend();
CREATE OR REPLACE FUNCTION public.my_pain_trend(p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(first_score smallint, latest_score smallint, latest_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (
    select coalesce(v.practitioner_score, v.patient_score) as score, a.starts_at
    from visit_pain_scores v
    join appointments a on a.id = v.appointment_id
    join patients p on p.id = a.patient_id
    where (case when p_patient_id is null then p.user_id = auth.uid() else p.id = p_patient_id and p.id in (select public.patients_i_can_see_clinically_for()) end)
      and a.deleted_at is null
      and coalesce(v.practitioner_score, v.patient_score) is not null
  )
  select (select score from s order by starts_at asc limit 1),
         (select score from s order by starts_at desc limit 1),
         (select starts_at::date from s order by starts_at desc limit 1)
  where public.mfa_satisfied() and exists (select 1 from s)
$function$;
revoke all on function public.my_pain_trend(uuid) from public, anon;
grant execute on function public.my_pain_trend(uuid) to authenticated, service_role;

drop function public.open_library_article(uuid);
CREATE OR REPLACE FUNCTION public.open_library_article(p_article_id uuid, p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_send_id uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'two-factor required' using errcode = '42501';
  end if;

  select a.account_id into v_account_id
  from learn_articles a
  where a.id = p_article_id and a.visible_to_patients and a.archived_at is null;
  if v_account_id is null then
    raise exception 'article not found' using errcode = 'P0002';
  end if;

  select p.id into v_patient_id
  from patients p
  where p.account_id = v_account_id and (case when p_patient_id is null then p.user_id = auth.uid() else p.id = p_patient_id and p.id in (select public.patients_i_can_see_clinically_for()) end)
  order by p.created_at
  limit 1;
  if v_patient_id is null then
    raise exception 'article not found' using errcode = 'P0002';
  end if;

  -- Sent to them before? Read that one, so it is marked read where the
  -- practitioner will look for it.
  select s.id into v_send_id
  from learn_sends s
  where s.patient_id = v_patient_id and s.article_id = p_article_id
  order by s.sent_at desc
  limit 1;

  if v_send_id is null then
    insert into learn_sends (account_id, patient_id, article_id, channel, opened_at)
    values (v_account_id, v_patient_id, p_article_id, 'library', now())
    on conflict (patient_id, article_id) where channel = 'library' do nothing
    returning id into v_send_id;
    if v_send_id is null then
      select s.id into v_send_id from learn_sends s
      where s.patient_id = v_patient_id and s.article_id = p_article_id and s.channel = 'library';
    end if;
  else
    update learn_sends set opened_at = now() where id = v_send_id and opened_at is null;
  end if;

  return v_send_id;
end;
$function$;
revoke all on function public.open_library_article(uuid, uuid) from public, anon;
grant execute on function public.open_library_article(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_exercise_done(p_patient_exercise_id uuid, p_done_on date, p_done boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  select pe.account_id into v_account_id
  from public.patient_exercises pe
  join public.patients p on p.id = pe.patient_id
  where pe.id = p_patient_exercise_id and p.id in (select public.patients_i_can_see_clinically_for()) and pe.ended_at is null;
  if v_account_id is null then
    return false;
  end if;
  if p_done then
    insert into public.patient_exercise_logs (account_id, patient_exercise_id, done_on)
    values (v_account_id, p_patient_exercise_id, p_done_on)
    on conflict (patient_exercise_id, done_on) do nothing;
  else
    delete from public.patient_exercise_logs where patient_exercise_id = p_patient_exercise_id and done_on = p_done_on;
  end if;
  return true;
end;
$function$;

drop function public.set_my_exercise_reminder(integer);
CREATE OR REPLACE FUNCTION public.set_my_exercise_reminder(p_hour integer, p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then
    raise exception 'Hour must be between 0 and 23';
  end if;
  update public.patients set exercise_reminder_hour = p_hour where (case when p_patient_id is null then user_id = auth.uid() else id = p_patient_id and id in (select public.patients_i_can_see_clinically_for()) end);
  return found;
end;
$function$;
revoke all on function public.set_my_exercise_reminder(integer, uuid) from public, anon;
grant execute on function public.set_my_exercise_reminder(integer, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_pain_score(p_appointment_id uuid, p_score smallint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Pain is scored from 0 to 10';
  end if;
  select a.account_id into v_account
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.id = p_appointment_id
    and p.id in (select public.patients_i_can_see_clinically_for())
    and a.status in ('booked', 'completed')
    and a.deleted_at is null
    and now() >= a.starts_at - interval '90 minutes'
    and now() < date_trunc('day', a.ends_at) + interval '1 day';
  if v_account is null then
    return false;
  end if;
  insert into public.visit_pain_scores (account_id, appointment_id, patient_score, patient_scored_at)
  values (v_account, p_appointment_id, p_score, now())
  on conflict (appointment_id) do update
    set patient_score = excluded.patient_score, patient_scored_at = now(), updated_at = now();
  return true;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 5. What the switcher reads, and withdrawing a link
-- ---------------------------------------------------------------------------
-- Me, and everybody I may act for, with what they are to me and how far the
-- link reaches. The app and the portal build the switcher from this.
create or replace function public.get_my_family()
returns table (
  patient_id uuid,
  account_id uuid,
  clinic_name text,
  first_name text,
  last_name text,
  gender text,
  is_self boolean,
  access text,
  basis text,
  relation text,
  link_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.id, p.account_id from public.patients p where p.user_id = (select auth.uid())
  )
  select p.id, p.account_id, a.name, p.first_name, p.last_name, p.gender,
         p.id in (select id from mine) as is_self,
         case when p.id in (select id from mine) then 'self' else m.access end,
         m.basis,
         (select r.relation from public.patient_relations r
           where r.patient_id = m.manager_patient_id and r.related_patient_id = p.id),
         m.id
  from public.patients p
  join public.accounts a on a.id = p.account_id
  left join public.patient_managers m
    on m.patient_id = p.id and m.manager_patient_id in (select id from mine)
  where p.id in (select public.patients_i_can_act_for())
    and public.mfa_satisfied()
  order by (p.id in (select id from mine)) desc, p.first_name, p.last_name;
$$;
revoke all on function public.get_my_family() from public, anon;
grant execute on function public.get_my_family() to authenticated, service_role;

-- Who may act for me: "Personas que gestionan tu cuenta", with a way out.
create or replace function public.get_my_managers()
returns table (link_id uuid, manager_first_name text, manager_last_name text, basis text, access text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, mp.first_name, mp.last_name, m.basis, m.access, m.created_at
  from public.patient_managers m
  join public.patients me on me.id = m.patient_id
  join public.patients mp on mp.id = m.manager_patient_id
  where me.user_id = (select auth.uid())
    and public.mfa_satisfied()
  order by m.created_at;
$$;
revoke all on function public.get_my_managers() from public, anon;
grant execute on function public.get_my_managers() to authenticated, service_role;

-- Either end may let go: the person managed (it is their record) or the
-- manager (it is their screen). Granting stays with the desk.
create or replace function public.withdraw_patient_manager(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  delete from public.patient_managers m
  where m.id = p_link_id
    and (m.patient_id in (select p.id from public.patients p where p.user_id = (select auth.uid()))
      or m.manager_patient_id in (select p.id from public.patients p where p.user_id = (select auth.uid())))
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;
revoke all on function public.withdraw_patient_manager(uuid) from public, anon;
grant execute on function public.withdraw_patient_manager(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Access log: reads done for somebody else
-- ---------------------------------------------------------------------------
-- Settings > Activity log already lists who opened a record; a family member
-- opening one from the app is listed beside the staff, named, with no team
-- member. Nothing is logged for a person reading their own record.
create or replace function public.log_family_access(p_patient_id uuid, p_kind text, p_detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_manager_id uuid;
  v_manager_name text;
  v_access text;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  if p_kind not in ('record_opened', 'file_viewed', 'file_downloaded', 'invoice_pdf') then
    raise exception 'Unknown access kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  select p.account_id into v_account_id from public.patients p
  where p.id = p_patient_id and p.id in (select public.patients_i_can_act_for());
  if v_account_id is null then
    raise exception 'Patient not found' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.patients p where p.id = p_patient_id and p.user_id = (select auth.uid())) then
    return;
  end if;

  select me.id, nullif(btrim(me.first_name || ' ' || coalesce(me.last_name, '')), ''), m.access
    into v_manager_id, v_manager_name, v_access
  from public.patient_managers m
  join public.patients me on me.id = m.manager_patient_id
  where m.patient_id = p_patient_id and me.user_id = (select auth.uid())
  limit 1;

  if p_kind = 'record_opened' and exists (
    select 1 from public.patient_access_log l
    where l.account_id = v_account_id and l.patient_id = p_patient_id and l.kind = 'record_opened'
      and l.team_member_id is null and l.detail ->> 'manager_patient_id' = v_manager_id::text
      and l.created_at > now() - interval '15 minutes'
  ) then
    return;
  end if;

  insert into public.patient_access_log (account_id, patient_id, team_member_id, actor_name, kind, detail)
  values (v_account_id, p_patient_id, null, v_manager_name, p_kind,
          jsonb_build_object('via', 'family', 'manager_patient_id', v_manager_id, 'access', v_access) || coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.log_family_access(uuid, text, jsonb) from public, anon;
grant execute on function public.log_family_access(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Signing up never lands on somebody else's record
-- ---------------------------------------------------------------------------
-- Families share an email (53 emails in production are on two or more
-- records of one clinic, 16 of those records under 18), and this linked a new
-- login to whichever matching record came first. A parent signing up could be
-- handed their child's or their partner's record. Now: never a minor's, and
-- when two adults' records share the email, nobody's -- the clinic links the
-- right one (or records the family link).
create or replace function public.claim_patient_profile(p_account_slug text default null)
returns table (patient_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_patient_id uuid;
  v_account_id uuid;
  v_match_count int;
  v_distinct_accounts int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from patients where user_id = auth.uid()) then
    return query select id from patients where user_id = auth.uid();
    return;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'No email on account';
  end if;

  if p_account_slug is not null then
    select id into v_account_id from accounts where slug = lower(trim(p_account_slug));
    if v_account_id is null then
      raise exception 'Unknown clinic';
    end if;
  end if;

  -- Candidates: unclaimed, not anonymised, and an adult as far as the
  -- record says.
  select count(*), count(distinct c.account_id) into v_match_count, v_distinct_accounts
  from patients c
  where lower(c.email) = lower(v_email) and c.user_id is null and c.anonymized_at is null
    and not c.is_minor
    and (c.date_of_birth is null or c.date_of_birth <= (current_date - interval '18 years')::date)
    and (v_account_id is null or c.account_id = v_account_id);

  if v_match_count = 0 then
    raise exception 'No matching patient record found';
  elsif v_distinct_accounts > 1 then
    raise exception 'Multiple clinics match this email -- specify one';
  elsif v_match_count > 1 then
    raise exception 'Several patient records share this email -- ask the clinic to link your account';
  end if;

  select c.id into v_patient_id
  from patients c
  where lower(c.email) = lower(v_email) and c.user_id is null and c.anonymized_at is null
    and not c.is_minor
    and (c.date_of_birth is null or c.date_of_birth <= (current_date - interval '18 years')::date)
    and (v_account_id is null or c.account_id = v_account_id);

  update patients set user_id = auth.uid() where id = v_patient_id;

  return query select v_patient_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Attribution and merging
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_actor(p_account_id uuid, OUT team_member_id uuid, OUT actor text, OUT actor_detail text, OUT actor_name text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb;
  v_role text;
  v_header text;
  v_uid uuid := auth.uid();
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_role := coalesce(v_claims ->> 'role', '');

  if v_uid is not null then
    select tm.id, tm.full_name into team_member_id, actor_name
    from public.team_members tm
    where tm.account_id = p_account_id and tm.user_id = v_uid;
    if team_member_id is not null then
      actor := 'staff';
    elsif exists (select 1 from public.patients p where p.account_id = p_account_id and p.user_id = v_uid) then
      actor := 'patient';
      -- Named since family accounts (20261106053857): a parent cancelling
      -- their child's visit is recorded on the child's row, and "a patient"
      -- would not say which one did it.
      select nullif(btrim(p.first_name || ' ' || coalesce(p.last_name, '')), '') into actor_name
      from public.patients p
      where p.account_id = p_account_id and p.user_id = v_uid
      order by p.created_at
      limit 1;
    else
      -- Signed in, but neither staff nor a patient here yet: someone creating
      -- their clinic, before their own team_members row exists.
      actor := 'user';
      select u.email into actor_detail from auth.users u where u.id = v_uid;
    end if;
    return;
  end if;

  if v_role = 'service_role' then
    begin
      v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-actor';
    exception when others then
      v_header := null;
    end;
    -- The AI receptionist booking or moving a visit on its own
    -- (server/utils/receptionistBooking.ts): named as itself, so what it
    -- changed can be found and put right.
    if v_header = 'receptionist' then
      actor := 'receptionist';
      actor_name := 'Recepcionista IA';
      return;
    end if;
    if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select tm.id, tm.full_name into team_member_id, actor_name
      from public.team_members tm
      where tm.id = v_header::uuid and tm.account_id = p_account_id;
    end if;
    actor := case when team_member_id is not null then 'staff' else 'server' end;
    return;
  end if;

  if v_role = 'anon' then
    actor := 'public';
    return;
  end if;

  actor := 'system';
  actor_detail := session_user::text;
end;
$function$;

-- merge_patients moves the links (CLAUDE.md). Restated from
-- 20261105195702_merge_patients_keeps_lists_and_habits.sql with the
-- patient_managers block after patient_relations and nothing else changed.
CREATE OR REPLACE FUNCTION public.merge_patients(p_survivor_id uuid, p_duplicate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- One active exercise schedule per person: the survivor's carries on, the
  -- duplicate's ends (and is kept, ended, with its history).
  if exists (select 1 from patient_exercise_schedules where patient_id = p_survivor_id and ended_at is null) then
    update patient_exercise_schedules set ended_at = now() where patient_id = p_duplicate_id and ended_at is null;
  end if;
  update patient_exercise_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
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

  -- Letters (patient_letters, 20261022185121) arrive in their own branch,
  -- which restates this function too; named only once the table exists, so
  -- whichever of the two applies second keeps both.
  if to_regclass('public.patient_letters') is not null then
    execute 'update public.patient_letters set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('patient_letters', v_count);
  end if;

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

  -- Lists (patient_list_members, 20261105143740): the survivor is on every
  -- list either record was on. Where both were, the survivor's own entry is
  -- kept -- it is the earlier added_at only by accident, but it is the one
  -- an automation may already have acted on.
  delete from patient_list_members d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_list_members s where s.patient_id = p_survivor_id and s.list_id = d.list_id);
  update patient_list_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_list_members', v_count);

  -- Segment stays (patient_segment_members): the history moves, except a
  -- current stay where the survivor has one of its own, which would be two
  -- at once. The next refresh settles whether the merged record still
  -- matches.
  delete from patient_segment_members d
   where d.patient_id = p_duplicate_id and d.left_at is null
     and exists (select 1 from patient_segment_members s where s.patient_id = p_survivor_id and s.segment_id = d.segment_id and s.left_at is null);
  update patient_segment_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_segment_members', v_count);

  -- Habit check-ins (Cuidarme › Mis hábitos, 20261105162805): the person's own
  -- record of looking after themselves, and their streak with it.
  update habit_checkins set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('habit_checkins', v_count);

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

  -- Who may act for whom in the app (patient_managers, 20261106053857), in
  -- both directions, as patient_relations above: a link between the two
  -- records goes, so does one the survivor already has, the rest move.
  delete from patient_managers
   where (manager_patient_id = p_duplicate_id and patient_id = p_survivor_id)
      or (manager_patient_id = p_survivor_id and patient_id = p_duplicate_id);
  delete from patient_managers d
   where d.manager_patient_id = p_duplicate_id
     and exists (select 1 from patient_managers s where s.manager_patient_id = p_survivor_id and s.patient_id = d.patient_id);
  delete from patient_managers d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_managers s where s.patient_id = p_survivor_id and s.manager_patient_id = d.manager_patient_id);
  update patient_managers set manager_patient_id = p_survivor_id where manager_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_managers', v_count);
  update patient_managers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  -- A message a family member sent for somebody names them; keep it named.
  update patient_app_messages set sent_by_patient_id = p_survivor_id where sent_by_patient_id = p_duplicate_id;

  -- Facturas addressed to the duplicate as a minor's tutor (recipient_patient_id,
  -- 20261021173018) are addressed to the survivor. Not a foreign key, so
  -- nothing would have stopped the delete below from leaving them pointing at
  -- a record that no longer exists.
  update facturas set recipient_patient_id = p_survivor_id where recipient_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas_addressed', v_count);

  -- Third-party cover and what third parties owe for the duplicate's visits
  -- (20261023093754). The charges are RESTRICT, so leaving them here would
  -- fail the delete below rather than lose them; the cover would cascade.
  update patient_third_parties set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_third_parties', v_count);
  update third_party_charges set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('third_party_charges', v_count);

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's.
  update patient_care_stops set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_care_stops', v_count);

  -- Who follows up the patient on Recalls (recall_assignments,
  -- 20261022185125): one row per patient, so of the two records' choices
  -- the more recent one is kept and becomes the survivor's.
  delete from recall_assignments d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from recall_assignments s where s.patient_id = p_survivor_id and s.assigned_at >= d.assigned_at);
  delete from recall_assignments s
   where s.patient_id = p_survivor_id
     and exists (select 1 from recall_assignments d where d.patient_id = p_duplicate_id);
  update recall_assignments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('recall_assignments', v_count);

  -- Custom fields (patient_attribute_values, 20261023053614), one answer per
  -- patient and field. As for the columns below, the survivor keeps the
  -- answers it already has and only its blanks are filled from the
  -- duplicate's.
  delete from patient_attribute_values d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_attribute_values s where s.patient_id = p_survivor_id and s.attribute_id = d.attribute_id);
  update patient_attribute_values set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_attribute_values', v_count);

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
$function$;
