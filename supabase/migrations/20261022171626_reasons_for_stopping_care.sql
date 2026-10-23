-- Reasons for stopping care: why a patient stopped coming, recorded when the
-- desk learns it, and counted by reason in Reports > Retention. Until now a
-- dismissed recall said only "dismissed on <date>" -- summer, price, got
-- better and moved away all looked the same, so nobody could say which of
-- them the clinic was losing people to. (PracticeHub 2.0 has the same list
-- under Settings > Communications > Recall, compared 22 Oct 2026.)
--
-- Two tables:
--
--   care_stop_reasons    the clinic's own list, edited in Settings > Recalls
--                        under communication_config (where the recall
--                        template lives). Seeded with six defaults, for
--                        every account now and for each new one by trigger,
--                        the way payment methods are (20260918081356).
--
--   patient_care_stops   one row per time a patient stopped: the reason, an
--                        optional note, who recorded it and when, and -- for
--                        the report -- the practitioner and clinic of their
--                        last attended visit, filled in by a trigger that can
--                        see every visit (an 'own'-calendar practitioner
--                        cannot read a colleague's).
--
-- A row is history, not a flag. A patient who stops in July for the summer,
-- comes back in September and stops again at Christmas over the price is two
-- rows, and both count in their periods. The CURRENT one is the row recorded
-- after the last visit the patient attended (current_care_stops); once they
-- attend again it stops being current, and recording again starts a new row.
-- Changing a current reason updates it in place and keeps who first recorded
-- it and when -- the audit trail has every change -- so editing an old
-- reason does not move it into this month's figures. Clearing deletes it.
--
-- A new patient_id column is three changes (CLAUDE.md): this table, the move
-- in merge_patients -- restated below from 20261021173018 with only the
-- patient_care_stops lines added -- and anonymisation, done as the family
-- links are (20261021171628): a trigger on the update that sets
-- anonymized_at, so the next version of anonymize_patient cannot forget it.
-- Also two-factor, the Data API grant and the audit trail, as every new table.
--
-- Nothing live reads or drops anything here, so the code already deployed is
-- unaffected until the release that uses it.

-- ---------------------------------------------------------------------------
-- The list

create table public.care_stop_reasons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null constraint care_stop_reasons_name_length check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index care_stop_reasons_name_uniq on public.care_stop_reasons (account_id, lower(name));
select public.grant_data_api('public.care_stop_reasons');

alter table public.care_stop_reasons enable row level security;

-- Everyone in the clinic reads the list (Recalls and the patient record offer
-- it); changing it is a Settings > Recalls job.
create policy "staff read care_stop_reasons" on public.care_stop_reasons for select
  using (public.is_account_member(account_id));
create policy "settings manage care_stop_reasons" on public.care_stop_reasons for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.care_stop_reasons');

create or replace function public.seed_care_stop_reasons(p_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.care_stop_reasons (account_id, name, sort_order)
  values
    (p_account_id, 'Mejoró', 10),
    (p_account_id, 'Precio', 20),
    (p_account_id, 'Sin tiempo', 30),
    (p_account_id, 'Verano / vacaciones', 40),
    (p_account_id, 'Se mudó', 50),
    (p_account_id, 'Otro', 60)
  on conflict (account_id, lower(name)) do nothing;
$$;
revoke all on function public.seed_care_stop_reasons(uuid) from public, anon, authenticated;

select public.seed_care_stop_reasons(id) from public.accounts;

-- A trigger rather than an edit to create_account_with_owner, for the reason
-- payment methods give: signup is not the only thing that makes an account.
create or replace function public.seed_care_stop_reasons_for_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_care_stop_reasons(new.id);
  return new;
end;
$$;
create trigger accounts_seed_care_stop_reasons
  after insert on public.accounts
  for each row execute function public.seed_care_stop_reasons_for_new_account();

-- ---------------------------------------------------------------------------
-- What was recorded

create table public.patient_care_stops (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- A reason deleted from the list leaves its stops counted, without a name.
  reason_id uuid references public.care_stop_reasons(id) on delete set null,
  note text constraint patient_care_stops_note_length check (note is null or length(note) <= 500),
  -- Who the patient was seeing, for "per practitioner and clinic". Set by
  -- patient_care_stops_fill, never by the client.
  practitioner_id uuid references public.team_members(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  recorded_by uuid references public.team_members(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index patient_care_stops_patient_idx on public.patient_care_stops (patient_id, recorded_at desc);
create index patient_care_stops_account_idx on public.patient_care_stops (account_id, recorded_at);
create index patient_care_stops_reason_idx on public.patient_care_stops (reason_id);
select public.grant_data_api('public.patient_care_stops');

alter table public.patient_care_stops enable row level security;

-- Seen by whoever may see the patient. Recorded from Recalls (recalls_access)
-- or from the patient's record (patients_edit), for a patient and a reason of
-- this account.
create policy "staff select patient_care_stops" on public.patient_care_stops for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));
create policy "staff insert patient_care_stops" on public.patient_care_stops for insert
  with check (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'recalls_access') or public.has_permission(account_id, 'patients_edit'))
    and public.can_access_patient(account_id, patient_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_care_stops.account_id)
    and (reason_id is null or exists (select 1 from public.care_stop_reasons r where r.id = reason_id and r.account_id = patient_care_stops.account_id))
  );
create policy "staff update patient_care_stops" on public.patient_care_stops for update
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'recalls_access') or public.has_permission(account_id, 'patients_edit'))
    and public.can_access_patient(account_id, patient_id)
  )
  with check (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'recalls_access') or public.has_permission(account_id, 'patients_edit'))
    and public.can_access_patient(account_id, patient_id)
    and (reason_id is null or exists (select 1 from public.care_stop_reasons r where r.id = reason_id and r.account_id = patient_care_stops.account_id))
  );
create policy "staff delete patient_care_stops" on public.patient_care_stops for delete
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'recalls_access') or public.has_permission(account_id, 'patients_edit'))
    and public.can_access_patient(account_id, patient_id)
  );
select public.require_two_factor_on('public.patient_care_stops');

-- The last visit the patient attended: not cancelled, not missed, not in the
-- future. SECURITY DEFINER because it has to see visits with a colleague an
-- 'own'-calendar practitioner cannot read; it answers only for a patient the
-- caller may see, and returns a date, nothing of the visit.
create or replace function public.patient_last_attended_at(p_patient_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(a.starts_at)
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.patient_id = p_patient_id
    and (auth.uid() is null or (public.is_account_member(p.account_id) and public.can_access_patient(p.account_id, p.id)))
    and a.status not in ('cancelled', 'no_show')
    and a.deleted_at is null
    and a.starts_at <= now();
$$;

-- Fills in who and where on insert, and keeps them on update: the
-- practitioner and clinic of the last attended visit (else the patient's
-- own), and the member recording it. Only a merge moves a stop to another
-- patient.
create or replace function public.patient_care_stops_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_practitioner uuid;
  v_clinic uuid;
begin
  if TG_OP = 'UPDATE' then
    new.account_id := old.account_id;
    new.recorded_at := old.recorded_at;
    new.recorded_by := old.recorded_by;
    new.practitioner_id := old.practitioner_id;
    new.clinic_id := old.clinic_id;
    return new;
  end if;

  select a.practitioner_id, a.clinic_id into v_practitioner, v_clinic
  from public.appointments a
  where a.patient_id = new.patient_id
    and a.status not in ('cancelled', 'no_show')
    and a.deleted_at is null
    and a.starts_at <= now()
  order by a.starts_at desc
  limit 1;

  select coalesce(v_practitioner, p.default_practitioner_id), coalesce(v_clinic, p.clinic_id)
    into new.practitioner_id, new.clinic_id
  from public.patients p
  where p.id = new.patient_id;

  new.recorded_at := now();
  if auth.uid() is not null then
    new.recorded_by := (
      select tm.id from public.team_members tm
      where tm.user_id = auth.uid() and tm.account_id = new.account_id and tm.deleted_at is null
      limit 1
    );
  end if;
  return new;
end;
$$;
create trigger patient_care_stops_fill
  before insert or update on public.patient_care_stops
  for each row execute function public.patient_care_stops_fill();

-- The current stop of each patient asked about, if they have one: the latest
-- recorded after their last attended visit. Runs as the caller, so RLS
-- decides which rows come back.
create or replace function public.current_care_stops(p_patient_ids uuid[])
returns setof public.patient_care_stops
language sql
stable
set search_path = ''
as $$
  select distinct on (s.patient_id) s.*
  from public.patient_care_stops s
  where s.patient_id = any(p_patient_ids)
    and s.recorded_at > coalesce(public.patient_last_attended_at(s.patient_id), '-infinity'::timestamptz)
  order by s.patient_id, s.recorded_at desc;
$$;

-- Record a reason for one or more patients (Recalls dismisses in bulk): the
-- current stop is updated, otherwise a new one is recorded. Runs as the
-- caller, so the policies above decide whether it may. Returns how many
-- patients it recorded for.
create or replace function public.record_care_stop(p_patient_ids uuid[], p_reason_id uuid, p_note text default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_patient uuid;
  v_current uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_rows integer;
  v_done integer := 0;
begin
  if p_reason_id is null then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;
  foreach v_patient in array coalesce(p_patient_ids, '{}'::uuid[]) loop
    v_current := null;
    select c.id into v_current from public.current_care_stops(array[v_patient]) c;
    if v_current is null then
      insert into public.patient_care_stops (account_id, patient_id, reason_id, note)
      select p.account_id, p.id, p_reason_id, v_note from public.patients p where p.id = v_patient;
    else
      update public.patient_care_stops set reason_id = p_reason_id, note = v_note where id = v_current;
    end if;
    get diagnostics v_rows = row_count;
    v_done := v_done + v_rows;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.record_care_stop(uuid[], uuid, text) from public, anon;
revoke all on function public.current_care_stops(uuid[]) from public, anon;
revoke all on function public.patient_last_attended_at(uuid) from public, anon;
grant execute on function public.record_care_stop(uuid[], uuid, text) to authenticated, service_role;
grant execute on function public.current_care_stops(uuid[]) to authenticated, service_role;
grant execute on function public.patient_last_attended_at(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit trail: the stops (patient data) and the list (a clinic setting).

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
  'appointment', 'patient', 'payment', 'visit_note', 'invoice', 'account_credit', 'package_purchase', 'patient_membership',
  'patient_file', 'patient_doc', 'team_member', 'team_member_clinic', 'role', 'account', 'clinic', 'invite', 'api_token',
  'webhook', 'verifactu_certificate', 'verifactu_delegation', 'cash_shift', 'cash_movement', 'package', 'membership',
  'service', 'appointment_type', 'patient_relation', 'care_stop', 'care_stop_reason'
]));
create trigger trg_audit_patient_care_stops after insert or update or delete on public.patient_care_stops
  for each row execute function public.fn_audit_log('care_stop');
create trigger trg_audit_care_stop_reasons after insert or update or delete on public.care_stop_reasons
  for each row execute function public.fn_audit_log('care_stop_reason', 'sort_order');

-- ---------------------------------------------------------------------------
-- Anonymising a record takes its stops with it: the note is free text about
-- the person.
create or replace function public.patients_drop_care_stops_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_care_stops where patient_id = new.id;
  end if;
  return new;
end;
$$;
create trigger patients_drop_care_stops_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_care_stops_on_anonymize();

-- ---------------------------------------------------------------------------
-- merge_patients moves them too (CLAUDE.md). Unchanged from 20261021173018
-- but for the patient_care_stops statement after the facturas addressed to a
-- tutor.
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

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's.
  update patient_care_stops set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_care_stops', v_count);

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
