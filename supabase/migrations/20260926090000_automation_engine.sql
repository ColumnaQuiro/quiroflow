-- The automation engine: one walker for every rule that waits, branches or
-- does something other than send.
--
-- Additive and backwards-compatible with the code already deployed. A rule
-- that exists today is exactly the rows it was: its steps stay in
-- automation_actions with parent_id NULL (the "root chain"), ordered by
-- position, and every new column has a default that describes today's
-- behaviour. The code that ships with this migration keeps sending those
-- rules down the same immediate path they take now; only a rule that uses a
-- flow step (a delay in a patient rule, a branch, a wait, a tag, a
-- notification) starts a run.
--
-- The one behaviour that changes on purpose, in the code and not here: a
-- `delay` in a PATIENT rule now waits, as it always has for leads. Which rules
-- that touches is `rulesWhoseDelayNowWaits()` in server/utils.

-- --------------------------------------------------------------- the tree
-- Steps form a tree through parent pointers. A chain is the rows sharing
-- (rule_id, parent_id, branch), ordered by position; `branch` names which
-- outlet of the parent the chain hangs from -- yes/no under a `branch` step,
-- met/timeout under a `wait_until`. There are no "end" rows: a chain simply
-- ends, and so does the run.
alter table public.automation_actions
  add column parent_id uuid references public.automation_actions(id) on delete cascade,
  add column branch text;

alter table public.automation_actions
  add constraint automation_actions_branch_check check (branch is null or branch in ('yes', 'no', 'met', 'timeout')),
  add constraint automation_actions_parent_has_branch check ((parent_id is null) = (branch is null));

alter table public.automation_actions drop constraint automation_actions_action_type_check;
alter table public.automation_actions
  add constraint automation_actions_action_type_check check (
    action_type in (
      'whatsapp_template', 'email', 'webhook', 'delay',
      'branch', 'wait_until', 'tag', 'notify', 'lead_stage', 'lead_assign'
    )
  );

create index automation_actions_chain_idx on public.automation_actions (rule_id, parent_id, branch, position);
create index automation_actions_parent_id_idx on public.automation_actions (parent_id) where parent_id is not null;

-- --------------------------------------------------------------- the rule
alter table public.automation_rules
  -- every_time: a new run per trigger (today's behaviour for patients).
  -- one_at_a_time: not while a run for the same person is still going.
  -- once_ever: never twice for the same person.
  add column entry_mode text not null default 'every_time'
    check (entry_mode in ('every_time', 'one_at_a_time', 'once_ever')),
  -- Events that end a person's run early.
  add column exit_on text[] not null default '{}'
    check (exit_on <@ array['appointment.booked', 'whatsapp.replied', 'lead.converted']::text[]),
  -- { from: '10:00', to: '20:00', days: [1..6] } in the clinic's time zone:
  -- a message step due outside it waits for the next allowed moment.
  add column quiet_hours jsonb,
  -- For trigger 'segment': { filters, schedule: { kind, weekday?, time,
  -- starts_at? }, reentry_days? }.
  add column segment jsonb,
  add column segment_last_run_at timestamptz;

-- A lead gets a drip once: that is what the unique (rule_id, lead_id) index
-- has always meant, now said in the column the editor will show.
update public.automation_rules set entry_mode = 'once_ever' where trigger_event = 'lead.created';

-- waitlist.slot_offered was dropped from this list by mistake in
-- 20260915035941 -- server/utils/waitlistOffer.ts still fires it and the
-- editor still offers it, so saving such a rule failed. Back, with 'segment'.
alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules
  add constraint automation_rules_trigger_event_check check (
    trigger_event in (
      'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
      'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
      'invoice.paid', 'patient.birthday', 'membership.new_member', 'membership.removed',
      'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'lead.created',
      'waitlist.slot_offered', 'segment'
    )
  );

create index automation_rules_segment_idx on public.automation_rules (account_id) where trigger_event = 'segment' and enabled;

-- Writing a rule now needs the permission that already gates the pages that
-- write them (/campaigns, /growth/automations). Reading stays open to every
-- member: the calendar's own trigger path runs server-side and is unaffected,
-- and the sidebar reads rules for its badge.
drop policy "staff manage automation_rules" on public.automation_rules;
create policy "staff read automation_rules" on public.automation_rules
  for select using (is_account_member(account_id));
create policy "config writers insert automation_rules" on public.automation_rules
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers update automation_rules" on public.automation_rules
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers delete automation_rules" on public.automation_rules
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

drop policy "staff manage automation_actions" on public.automation_actions;
create policy "staff read automation_actions" on public.automation_actions
  for select using (is_account_member(account_id));
create policy "config writers insert automation_actions" on public.automation_actions
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers update automation_actions" on public.automation_actions
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers delete automation_actions" on public.automation_actions
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

-- --------------------------------------------------------------- runs
-- automation_sequence_runs keeps its name and becomes the run of ANY rule
-- that waits: a lead's drip, as before, or a patient's.
--
-- compat-ok: the new foreign keys (runs -> patients, runs -> appointments,
-- runs -> automation_actions, automation_actions -> itself) are each the FIRST
-- relationship between their pair of tables, so no existing embed gains a
-- second one; the embeds the compatibility check lists are patients(...) and
-- appointments(...) from OTHER tables. Checked against PostgREST with this
-- migration applied: appointments->patients, invoices->appointments,
-- leads->patients, patients->appointments and patients->leads all still
-- embed without a hint. Nothing is dropped that live code reads -- the
-- constraints and policies dropped below are re-created in this file.
alter table public.automation_sequence_runs
  alter column lead_id drop not null,
  add column patient_id uuid references public.patients(id) on delete cascade,
  add column appointment_id uuid references public.appointments(id) on delete set null,
  -- The trigger's payload, so a step three days later still knows which
  -- appointment, invoice or waitlist slot it is about.
  add column context jsonb not null default '{}'::jsonb,
  -- Where the run is. NULL means "the root chain at next_position", which is
  -- how every lead run before this migration reads, and what a run falls back
  -- to if the step it pointed at is deleted.
  add column current_action_id uuid references public.automation_actions(id) on delete set null,
  -- 'delay' while parked at a delay (resume after current_action_id), or the
  -- event a wait_until is waiting for.
  add column waiting_for text,
  add column wait_deadline timestamptz,
  add column branch_taken text;

alter table public.automation_sequence_runs
  add constraint automation_sequence_runs_one_subject check (num_nonnulls(lead_id, patient_id) = 1);

-- The unique (rule_id, lead_id) index stays exactly as it is: NULLs never
-- collide in a unique index, so it already constrains lead runs only. Entry
-- modes for patients are enforced where runs start.
create index automation_sequence_runs_patient_idx on public.automation_sequence_runs (rule_id, patient_id) where patient_id is not null;
create index automation_sequence_runs_patient_id_idx on public.automation_sequence_runs (patient_id) where patient_id is not null;
create index automation_sequence_runs_appointment_id_idx on public.automation_sequence_runs (appointment_id) where appointment_id is not null;
create index automation_sequence_runs_current_action_id_idx on public.automation_sequence_runs (current_action_id) where current_action_id is not null;
create index automation_sequence_runs_waiting_idx on public.automation_sequence_runs (account_id, waiting_for) where status = 'running' and waiting_for is not null;

-- Runs in flight carry on exactly where they are: the step they will run next
-- is the root-chain action at or after next_position, which is what the code
-- before this read on every tick.
update public.automation_sequence_runs r
   set current_action_id = (
     select a.id from public.automation_actions a
      where a.rule_id = r.rule_id and a.parent_id is null and a.position >= r.next_position
      order by a.position
      limit 1
   )
 where r.status in ('running', 'failed');

-- The run history gains the outcomes the new steps produce.
alter table public.automation_run_events drop constraint automation_run_events_outcome_check;
alter table public.automation_run_events
  add constraint automation_run_events_outcome_check check (
    outcome in (
      'started', 'sent', 'dry_run', 'skipped', 'failed', 'waiting', 'deferred', 'stopped', 'finished', 'retried',
      'branched', 'met', 'timed_out', 'applied'
    )
  );

-- --------------------------------------------------------------- merge_patients
-- automation_sequence_runs.patient_id is a new patient_id column, so it goes
-- into merge_patients (CLAUDE.md): without the line below, merging a duplicate
-- would cascade-delete every automation run on it. Copied from
-- 20260922175142_merge_and_delete_keep_the_money.sql (md5 of prosrc verified
-- against the database before editing); the only change is the runs line.
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
    external_reference     = coalesce(nullif(s.external_reference, ''), d.external_reference),
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

comment on function merge_patients(uuid, uuid) is
  'Moves every record belonging to p_duplicate_id onto p_survivor_id -- including payments, facturas and automation runs -- fills the survivor''s blank fields from the duplicate, then deletes the duplicate. Requires patients_delete_merge on the shared account.';
