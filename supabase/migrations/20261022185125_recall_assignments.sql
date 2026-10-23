-- Recalls get an owner: who on the team follows up each lapsed patient, so
-- the calls are split and nobody chases the same person twice. PracticeHub's
-- Recalls list has the same ("Assigned to", defaulting to You) and so does
-- its setting for recalls nobody has assigned yet.
--
-- recall_candidates is computed, not stored: a patient is on it while they
-- have no visit ahead and their last attended one is long enough ago. So the
-- choice lives in its own table keyed by patient, and the view reads it.
--
-- A row is an explicit choice, made on the Recalls page -- including "nobody"
-- (team_member_id null). It counts only for the lapse it was made in: once
-- the patient attends again, last_appointment_at passes assigned_at and the
-- row stops applying, so the next time they lapse they arrive like anyone
-- new rather than still carrying a colleague's name from a year ago.
--
-- Without a row that counts, the clinic's default applies, at read time
-- (accounts.recall_assignee_default, Settings): their default practitioner,
-- nobody, or one chosen person. Nothing is written when a patient lands on
-- the list, because nothing notices them land: no cron, no trigger, only a
-- view.

create table public.recall_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  -- null: deliberately nobody, which overrides the clinic's default.
  team_member_id uuid references public.team_members(id) on delete set null,
  assigned_by uuid references public.team_members(id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index recall_assignments_account_member_idx on public.recall_assignments (account_id, team_member_id);
select public.grant_data_api('public.recall_assignments');

alter table public.recall_assignments enable row level security;

-- Seen by whoever may see the patient; set by whoever works Recalls, for a
-- patient they may see and a colleague of the same account.
create policy "staff select recall_assignments" on public.recall_assignments for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));
create policy "staff insert recall_assignments" on public.recall_assignments for insert
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'recalls_access')
    and public.can_access_patient(account_id, patient_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = recall_assignments.account_id)
    and (team_member_id is null or exists (
      select 1 from public.team_members tm
      where tm.id = team_member_id and tm.account_id = recall_assignments.account_id and tm.deleted_at is null))
  );
create policy "staff update recall_assignments" on public.recall_assignments for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'recalls_access') and public.can_access_patient(account_id, patient_id))
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'recalls_access')
    and public.can_access_patient(account_id, patient_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = recall_assignments.account_id)
    and (team_member_id is null or exists (
      select 1 from public.team_members tm
      where tm.id = team_member_id and tm.account_id = recall_assignments.account_id and tm.deleted_at is null))
  );
create policy "staff delete recall_assignments" on public.recall_assignments for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'recalls_access') and public.can_access_patient(account_id, patient_id));
select public.require_two_factor_on('public.recall_assignments');

-- Adds 'recall_assignment' to whatever the constraint allows when this runs,
-- rather than restating the list: other branches are adding entity types at
-- the same time (the read-and-append block from 20261022173310).
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['recall_assignment']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_recall_assignments after insert or update or delete on public.recall_assignments
  for each row execute function public.fn_audit_log('recall_assignment');

-- Anonymising a record takes its assignment with it.
create or replace function public.patients_drop_recall_assignment_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.recall_assignments where patient_id = new.id;
  end if;
  return new;
end;
$$;
create trigger patients_drop_recall_assignment_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_recall_assignment_on_anonymize();

-- ---------------------------------------------------------------------------
-- The clinic's default, for a patient nobody has assigned during this lapse.
-- 'nobody' is today's behaviour, so nothing changes until a clinic chooses.
-- recall_assignee_member_id is not a foreign key: one from accounts to
-- team_members would make every accounts <-> team_members embed ambiguous
-- (team_members.account_id already joins them). A colleague who leaves is
-- caught where it is read, below.
alter table public.accounts
  add column recall_assignee_default text not null default 'nobody'
    check (recall_assignee_default in ('practitioner', 'nobody', 'member')),
  add column recall_assignee_member_id uuid;

-- Settings > Recalls, under communication_config with the rest of the
-- clinic's messaging (20260930080701). Unchanged from 20261012125117 but for
-- the recall_assignee line.
create or replace function public.accounts_settings_permission(p_column text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Settings > Online Booking, Mobile App, Scheduling Policies, New Patient Fields
    when p_column like 'online_booking\_%' or p_column like 'patient_app\_%'
      or p_column in ('cancellation_fee_cents', 'missed_appointment_fee_cents', 'scheduling_policy_fee_cents', 'new_patient_field_config')
      -- Waitlist > how freed slots are offered
      or p_column like 'waitlist\_%'
      -- Online Booking > referral programme
      or p_column like 'referral\_%'
      then 'clinic_config'
    -- Settings > Invoicing, Payments
    when p_column like 'invoice\_email\_%' or p_column like 'hide\_%' or p_column like 'show\_%\_on_invoices' or p_column like 'stripe\_%' or p_column like 'factura\_%'
      or p_column in ('send_invoices_automatically_default', 'next_invoice_number', 'rectificativa_prefix')
      then 'billing_config'
    -- Settings > Messages, WhatsApp, Leads (and the Meta/Instagram connections)
    when p_column like 'appointment\_confirmation\_%' or p_column like 'appointment\_reminder\_%' or p_column like 'email\_%'
      or p_column like 'whatsapp\_%' or p_column like 'instagram\_%' or p_column like 'meta\_ads\_%' or p_column like 'lead\_%' or p_column like 'new_lead_notify\_%'
      or p_column in ('google_review_url', 'default_phone_country')
      -- Settings > Recalls: who a new recall is assigned to
      or p_column like 'recall\_assignee\_%'
      then 'communication_config'
    -- Settings > Import (PracticeHub connection)
    when p_column like 'practicehub\_%' then 'data_admin'
    -- Settings > Team (require two-factor)
    when p_column = 'require_two_factor' then 'team_admin'
    -- Guarded by accounts_guard_verifactu, not here.
    when p_column like 'verifactu\_%' then 'verifactu'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- recall_candidates, unchanged from 20261003155100 but for assigned_to at the
-- end: the explicit choice of this lapse, else the clinic's default, and
-- never a colleague who has since left (null, i.e. unassigned, instead).
-- Postgres computes the column only when it is selected or filtered on, so
-- the list and the badge pay for it and nothing else that reads the view.
create or replace view public.recall_candidates
  with (security_invoker = true)
as
select f.patient_id,
       p.account_id,
       p.first_name,
       p.last_name,
       p.email,
       p.tags,
       lb.balance_cents,
       p.recall_priority,
       p.default_practitioner_id,
       f.last_appointment_at,
       current_date - f.last_appointment_at::date as days_since_last_appointment,
       p.preferred_language,
       p.clinic_id,
       f.last_no_show_at,
       (
         select tm.id from team_members tm
         where tm.deleted_at is null
           and tm.id = case
             when ra.id is not null then ra.team_member_id
             when acc.recall_assignee_default = 'practitioner' then p.default_practitioner_id
             when acc.recall_assignee_default = 'member' then acc.recall_assignee_member_id
           end
       ) as assigned_to
from patient_visit_facts() f
cross join lateral (select p1.* from patients p1 where p1.id = f.patient_id offset 0) p
left join patient_live_balances lb on lb.patient_id = p.id
left join recall_assignments ra on ra.patient_id = p.id and ra.assigned_at > f.last_appointment_at
left join accounts acc on acc.id = p.account_id
where f.last_appointment_at is not null
  and not f.has_future_appointment
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor
  and (p.recall_snoozed_until is null or p.recall_snoozed_until <= current_date)
  and (
    p.recall_status = 'active'
    or (p.recall_status = 'dismissed' and p.recall_dismissed_at is not null and f.last_appointment_at > p.recall_dismissed_at)
  );

-- ---------------------------------------------------------------------------
-- The sidebar's Recalls badge counts what is the caller's to do: assigned to
-- them, or to nobody. recalls_mine is the first half alone, which the page
-- reads to open on "Mine" for someone who has any. Unchanged from
-- 20261018091044 otherwise.
create or replace function public.get_nav_badges(
  p_team_member_id uuid,
  p_clinic_id uuid,
  p_recalls_clinic_id uuid,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_with_recalls boolean
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with recalls as (
    select count(*) filter (where rc.assigned_to is null or rc.assigned_to = p_team_member_id) as todo,
           count(*) filter (where rc.assigned_to = p_team_member_id) as mine
    from recall_candidates rc
    where p_with_recalls
      and rc.days_since_last_appointment >= 21
      and (p_recalls_clinic_id is null or rc.clinic_id = p_recalls_clinic_id or rc.clinic_id is null)
  )
  select jsonb_build_object(
    'my_day', (
      select count(*) from appointments a
      where a.practitioner_id = p_team_member_id
        and a.status <> 'cancelled' and a.deleted_at is null
        and a.starts_at >= p_day_start and a.starts_at < p_day_end
        and (p_clinic_id is null or a.clinic_id = p_clinic_id)
    ),
    'automations_active', exists (select 1 from automation_rules r where r.enabled),
    'inbox_unread', public.inbox_unread_count(),
    'support_unread', coalesce((
      select c.clinic_unread from support_conversations c
      order by c.last_message_at desc limit 1
    ), false),
    'recalls', case when p_with_recalls then (select todo from recalls) end,
    'recalls_mine', case when p_with_recalls then (select mine from recalls) end
  );
$function$;

-- ---------------------------------------------------------------------------
-- Being assigned recalls is a push, switchable in the app's Profile > Avisos
-- like every other kind (server/utils/staffPush.ts). Additive: the apps
-- already released upsert the columns they know and leave this one to its
-- default.
alter table public.staff_push_preferences
  add column if not exists recall_assignments boolean not null default true;

-- ---------------------------------------------------------------------------
-- merge_patients moves them too (CLAUDE.md). Unchanged from 20261022171626
-- but for the recall_assignments statements after the reasons for stopping
-- care.
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
