-- Posture comparisons the practitioner sends the patient.
--
-- Comparing two posture assessments needs nothing stored: it is the two rows
-- read together (utils/postureCompare.ts), and the patient can already
-- compare whichever assessments were shared with them one by one. This table
-- is for the other case: the practitioner picks two, writes a line about what
-- they show, and sends THAT to the patient's app. The row is the permission
-- -- the patient sees those two assessments inside the comparison whether or
-- not each is shared on its own -- and what the "Comparativas enviadas" list
-- on the record shows.
--
-- One row per pair: sending the same two again updates the comment rather
-- than stacking a second card in the patient's app
-- (server/api/posture/comparisons.post.ts).

create table public.posture_comparisons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- The earlier and the later of the two. Deleting either assessment deletes
  -- the comparison: half of one says nothing.
  before_assessment_id uuid not null references public.posture_assessments(id) on delete cascade,
  after_assessment_id uuid not null references public.posture_assessments(id) on delete cascade,
  note text check (note is null or char_length(note) <= 2000),
  created_by uuid references public.team_members(id) on delete set null,
  shared_with_patient boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (before_assessment_id <> after_assessment_id),
  unique (before_assessment_id, after_assessment_id)
);
create index posture_comparisons_patient on public.posture_comparisons (patient_id, created_at desc);
create index posture_comparisons_after on public.posture_comparisons (after_assessment_id);
select public.grant_data_api('public.posture_comparisons');

alter table public.posture_comparisons enable row level security;
-- Clinical, under the same permissions as the assessments themselves. On
-- insert and update both assessments must be THIS patient's in THIS account:
-- the ids are what the writer sends, so they cannot be taken on trust.
create policy "staff select posture_comparisons" on public.posture_comparisons for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
create policy "staff insert posture_comparisons" on public.posture_comparisons for insert
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access')
    and exists (select 1 from public.posture_assessments a where a.id = before_assessment_id and a.patient_id = posture_comparisons.patient_id and a.account_id = posture_comparisons.account_id)
    and exists (select 1 from public.posture_assessments a where a.id = after_assessment_id and a.patient_id = posture_comparisons.patient_id and a.account_id = posture_comparisons.account_id)
  );
create policy "staff update posture_comparisons" on public.posture_comparisons for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'))
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access')
    and exists (select 1 from public.posture_assessments a where a.id = before_assessment_id and a.patient_id = posture_comparisons.patient_id and a.account_id = posture_comparisons.account_id)
    and exists (select 1 from public.posture_assessments a where a.id = after_assessment_id and a.patient_id = posture_comparisons.patient_id and a.account_id = posture_comparisons.account_id)
  );
create policy "staff delete posture_comparisons" on public.posture_comparisons for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
-- The patient (or whoever manages them in a family account) sees the ones
-- sent to them; /api/portal/posture reads the two assessments after this.
create policy "patients view own shared posture_comparisons" on public.posture_comparisons for select
  using (shared_with_patient and patient_id in (select public.patients_i_can_see_clinically_for()));
select public.require_two_factor_on('public.posture_comparisons');

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
-- Read-and-append, as 20261112060227 does, so this keeps whatever types other
-- migrations have added whichever order they apply in.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['posture_comparison']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_posture_comparisons after insert or update or delete on public.posture_comparisons
  for each row execute function public.fn_audit_log('posture_comparison', 'updated_at');

-- ---------------------------------------------------------------------
-- merge_patients moves them
-- ---------------------------------------------------------------------
-- Restated in full from 20261112060227_gocardless_direct_debit with
-- posture_comparisons added after posture_assessments (CLAUDE.md: a new
-- patient_id column has to be added here as well, or a merge deletes it with
-- the duplicate). The next migration that restates this function must start
-- from this file.
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
  update patient_gocardless_mandates set patient_id = p_survivor_id where patient_id = p_duplicate_id;
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

  -- The comparisons of those assessments the practitioner sent the patient.
  update posture_comparisons set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('posture_comparisons', v_count);

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
$$;

-- ---------------------------------------------------------------------
-- anonymize_patient removes them
-- ---------------------------------------------------------------------
-- Restated from 20261112060227_gocardless_direct_debit with one line added.
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
  v_posture text[];
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
  delete from patient_exercise_schedules where patient_id = p_patient_id;
  delete from patient_gocardless_mandates where patient_id = p_patient_id;
  if to_regclass('public.learn_sends') is not null then
    execute 'delete from public.learn_sends where patient_id = $1' using p_patient_id;
  end if;
  -- The practitioner's comment on a comparison is clinical too. Before the
  -- assessments, which would take these with them anyway (their foreign keys
  -- cascade): said outright, so it does not rest on that.
  delete from posture_comparisons where patient_id = p_patient_id;
  -- Posture photos are in storage too: their paths go back with the files.
  if to_regclass('public.posture_assessments') is not null then
    execute $q$select coalesce(array_agg(v.value ->> 'photo') filter (where v.value ->> 'photo' is not null), '{}')
      from public.posture_assessments pa, jsonb_each(pa.views) v where pa.patient_id = $1$q$
      into v_posture using p_patient_id;
    v_files := coalesce(v_files, '{}') || v_posture;
    execute 'delete from public.posture_assessments where patient_id = $1' using p_patient_id;
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
