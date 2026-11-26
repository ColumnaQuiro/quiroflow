-- Blind Spot (punto ciego): a visual-field test run in the browser, sold two
-- ways -- as an add-on for clinics on QuiroFlow, and on its own to a clinic
-- that wants only the test (accounts.product = 'blind_spot').
--
-- 1. blind_spot_tests       one measurement of both eyes
-- 2. the add-on             addons row + subscriptions.blind_spot_addon
-- 3. the standalone product plans row 'blind_spot' + accounts.product
-- 4. account_has_blind_spot the entitlement, for RLS
-- 5. merge_patients / anonymize_patient move and delete the new rows
-- 6. get_my_bootstrap       carries the product and the add-on flag
--
-- The prices are in the platform's Stripe account (Quiroflow, live), ex-IVA
-- like every price here, the annual ones ~10% off as for the other add-ons:
--   add-on  prod_VhNR8Jrz3LY1qU "QuiroFlow Blind Spot (add-on)"  19/month, 204/year
--   plan    prod_VhNRcSVllm1UTE "QuiroFlow Blind Spot"           29/month, 312/year

-- ---------------------------------------------------------------------
-- 1. blind_spot_tests
-- ---------------------------------------------------------------------
-- One row is both eyes measured once. A before/after-the-adjustment pair is
-- two rows sharing session_id, phase 'pre' and 'post'; a lone measurement is
-- phase 'single' with a session of its own.
--
-- Each eye is {"points":[{"angle":deg,"r":deg|null}], "catch_trials":n,
-- "false_positives":n}: angle around the blind spot's expected centre (0 =
-- temporal, counter-clockwise), r how far out the patient first saw the dot,
-- in degrees of visual angle, null when it was never seen. The area is
-- computed by the browser (utils/blindSpot.ts) and stored, so lists and the
-- PDF never recompute it from points with different rules.
create table public.blind_spot_tests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id uuid not null default gen_random_uuid(),
  phase text not null default 'single' check (phase in ('single', 'pre', 'post')),
  right_eye jsonb not null,
  left_eye jsonb not null,
  right_area numeric(7,2),
  left_area numeric(7,2),
  points_per_eye smallint not null check (points_per_eye between 4 and 72),
  distance_cm numeric(5,1) not null check (distance_cm between 20 and 120),
  px_per_mm numeric(7,3) not null check (px_per_mm > 0),
  note text check (note is null or char_length(note) <= 2000),
  tested_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, phase)
);
create index blind_spot_tests_patient on public.blind_spot_tests (patient_id, tested_at desc);
create index blind_spot_tests_account on public.blind_spot_tests (account_id, tested_at desc);
select public.grant_data_api('public.blind_spot_tests');

-- ---------------------------------------------------------------------
-- 2. The add-on, and 3. the standalone product
-- ---------------------------------------------------------------------
insert into addons (id, name, monthly_price_cents, annual_price_cents, stripe_monthly_price_id, stripe_annual_price_id)
values (
  'blind_spot', 'Blind Spot', 1900, 1700,
  'price_1UfygT0Ov3CXtGBc38pW0Q9z',   -- 19,00 EUR / month
  'price_1Ufygd0Ov3CXtGBc12BCDvjb'    -- 204,00 EUR / year
);

alter table subscriptions add column blind_spot_addon boolean not null default false;
comment on column subscriptions.blind_spot_addon is
  'Whether this account has bought Blind Spot as an add-on. The Blind Spot plan includes it without this being set; account_has_blind_spot() and hasBlindSpot() read both.';

-- Its own plan rather than "Solo with the add-on": a clinic that wants only
-- the test is not buying a practice-management plan, and charging it one to
-- reach a 29 euro product is the sale this exists to make.
insert into plans (id, name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, extra_professional_price_cents, sort_order, stripe_monthly_price_id, stripe_annual_price_id)
values (
  'blind_spot', 'Blind Spot', 2900, 2600, null, null, null, 90,
  'price_1Ufyge0Ov3CXtGBcilrDjWc8',   -- 29,00 EUR / month
  'price_1Ufygm0Ov3CXtGBcYi4LNPdJ'    -- 312,00 EUR / year
);

-- Which app the account sees: the whole of QuiroFlow, or only Blind Spot
-- (patients, tests, reports, settings, subscription). Written by the service
-- role only -- /api/blind-spot/product at sign-up and when moving to the full
-- product -- so accounts_settings_permission() deliberately does not list
-- it: a member who is not the owner gets "Only an owner can change product".
alter table accounts add column product text not null default 'clinic'
  check (product in ('clinic', 'blind_spot'));

-- ---------------------------------------------------------------------
-- 4. The entitlement
-- ---------------------------------------------------------------------
-- The same reading as hasBlindSpot() (utils/blindSpotPlan.ts): comped has
-- it; locked and cancelled keep nothing; a trial includes it, as it includes
-- Growth; otherwise the add-on or the Blind Spot plan.
create or replace function public.account_has_blind_spot(p_account_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
    where s.account_id = p_account_id
      and (
        s.comped
        or (
          s.status not in ('locked', 'canceled')
          and (s.status = 'trialing' or s.blind_spot_addon or s.plan_id = 'blind_spot')
        )
      )
  );
$$;
revoke all on function public.account_has_blind_spot(uuid) from public, anon;
grant execute on function public.account_has_blind_spot(uuid) to authenticated;

alter table public.blind_spot_tests enable row level security;
-- Clinical, under the same permissions as posture beside it on Progreso.
-- A new test needs the account to have Blind Spot; reading the ones already
-- taken does not, so a clinic that stops paying keeps its patients' history.
create policy "staff select blind_spot_tests" on public.blind_spot_tests for select
  using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'progress_access') or public.has_permission(account_id, 'visit_notes_access'))
  );
create policy "staff insert blind_spot_tests" on public.blind_spot_tests for insert
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access')
    and public.account_has_blind_spot(account_id)
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = blind_spot_tests.account_id)
  );
create policy "staff update blind_spot_tests" on public.blind_spot_tests for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit')
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = blind_spot_tests.account_id));
create policy "staff delete blind_spot_tests" on public.blind_spot_tests for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_delete'));
select public.require_two_factor_on('public.blind_spot_tests');

-- The audit trail: read-and-append to the check constraint, so this cannot
-- drop an entity type another open branch adds.
do $$
declare v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['blind_spot_test']) x order by 1);
  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_blind_spot_tests after insert or update or delete on public.blind_spot_tests
  for each row execute function public.fn_audit_log('blind_spot_test', 'updated_at');

-- ---------------------------------------------------------------------
-- 5. merge_patients moves them, anonymize_patient deletes them
-- ---------------------------------------------------------------------
-- Restated in full from 20261117075000_gocardless_mandate_requests with
-- blind_spot_tests added after posture_comparisons (CLAUDE.md: a new
-- patient_id column is two changes -- three for clinical data). The next
-- migration that restates either function must start from this file.
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
  update gocardless_billing_requests set patient_id = p_survivor_id where patient_id = p_duplicate_id;
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

  -- Blind Spot tests (20261126082211_blind_spot.sql).
  update blind_spot_tests set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('blind_spot_tests', v_count);

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
  delete from gocardless_billing_requests where patient_id = p_patient_id;
  if to_regclass('public.learn_sends') is not null then
    execute 'delete from public.learn_sends where patient_id = $1' using p_patient_id;
  end if;
  -- The practitioner's comment on a comparison is clinical too. Before the
  -- assessments, which would take these with them anyway (their foreign keys
  -- cascade): said outright, so it does not rest on that.
  delete from posture_comparisons where patient_id = p_patient_id;
  delete from blind_spot_tests where patient_id = p_patient_id;
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

-- ---------------------------------------------------------------------
-- 6. get_my_bootstrap carries the product and the add-on
-- ---------------------------------------------------------------------
-- Restated from 20261018091044_bootstrap_carries_the_gate_and_nav_badges_in_one
-- with accounts.product and subscriptions.blind_spot_addon added: the route
-- guard decides which app to show before anything else loads.
create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with gate as (
    select public.get_my_two_factor_gate() as g
  ),
  me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
      and public.mfa_satisfied()
    limit 1
  )
  select case
    when (select g from gate) <> 'ok' then jsonb_build_object('two_factor', (select g from gate), 'team_member', null)
    when not exists (select 1 from me) then jsonb_build_object('two_factor', 'ok', 'team_member', null)
    else (
      select jsonb_build_object(
        'two_factor', 'ok',
        'team_member', to_jsonb(me.*),
        'account', (
          select to_jsonb(a) from (
            select name, slug, whatsapp_confirmation_template_name,
                   whatsapp_recall_template_name, scheduling_policy_fee_cents,
                   default_phone_country, require_two_factor, product
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id and archived_at is null
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at, growth_addon, receptionist_addon, blind_spot_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;
