-- A practitioner whose role sees only their own patients ('own' patients
-- scope) could read every patient's contact data straight from the API. The
-- patients table has scoped its rows since 0142, but five tables hanging off
-- a patient were still gated on account membership alone:
--
--   patient_contact_numbers  phone numbers            (0006: for all, is_account_member)
--   care_plans               treatment plans          (0056: for all, is_account_member)
--   email_messages           emails sent to them      (20260918151828: select, any member)
--   waitlist_entries         who is waiting, for what (0130: for all, is_account_member)
--   contact_log              recall calls and sends   (0041: recalls_access only)
--
-- so `select * from patient_contact_numbers` returned the whole clinic's
-- phone book to someone the app shows seven patients. Each now applies the
-- patients policy's own rule to its patient_id: 'all' scope sees every row of
-- the account, 'own' scope the rows of my_own_patient_ids() -- the patients
-- they are the default practitioner for or have an appointment with -- and
-- 'none' nothing. Written in the same hoisted form as "staff select patients"
-- (0142 / 20260923120000), so the scope is resolved once per query rather
-- than once per row, and the own-patient set is hashed once.
--
-- The same expression gates writes (with check), so a practitioner cannot
-- file a number, plan or waitlist place against somebody else's patient
-- either. Everything the app writes into these tables is for a patient the
-- writer can already see: the calendar's and the Patients page's "new
-- patient" both make the new patient the writer's own when they have 'own'
-- scope, before the number goes in.
--
-- Unchanged: owners and 'all'-scope roles (Front Desk) see exactly what they
-- saw before; contact_log still also needs recalls_access; email_messages
-- about a lead rather than a patient (patient_id null) stay readable to every
-- member as before; the patients' own policies ("patients view own ...") are
-- not touched; server code on the service role is not subject to any of it.
--
-- Two waitlist readers would otherwise lose something they need:
--
--   * The calendar draws a slot freed by a cancellation and offered to the
--     waitlist where the visit was, so nobody books over it. A practitioner's
--     own slot can be offered to a patient who is not (yet) theirs, so 'own'
--     scope also sees entries offered for their own slots. Who it was offered
--     to stays hidden -- the patients row is still theirs to see or not --
--     and the calendar already says "the waitlist" when there is no name.
--
--   * Cancelling a visit shows whether someone on the waitlist matches the
--     freed slot, and offers it. waitlist_waiting_in_clinic() answers that
--     with the entries' shape -- id, when, which type, which practitioner --
--     and no patient, so the match is the same for everyone and nobody learns
--     who is waiting through it. The names of the patients the caller may
--     see are read separately, through this policy.
--     (The offer itself is made with the service role: the oldest matching
--     entry gets it whoever cancelled, as before.)

alter policy "staff manage patient_contact_numbers" on public.patient_contact_numbers
  using (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  )
  with check (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  );

alter policy "staff manage care_plans" on public.care_plans
  using (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  )
  with check (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  );

alter policy "staff read email_messages" on public.email_messages
  using (
    account_id in (select my_member_account_ids())
    and (
      patient_id is null
      or (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  );

alter policy "staff manage waitlist_entries" on public.waitlist_entries
  using (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  )
  with check (
    account_id in (select my_member_account_ids())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  );

-- Read-only, and only the practitioner's own slots: an offer is made by the
-- server (service role), never by this policy.
create policy "staff read waitlist offers for their own slots" on public.waitlist_entries
  for select
  using (
    account_id in (select my_member_account_ids())
    and offered_practitioner_id = (select my_team_member_id())
  );

alter policy "staff manage contact_log" on public.contact_log
  using (
    is_account_member(account_id)
    and has_permission(account_id, 'recalls_access')
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  )
  with check (
    is_account_member(account_id)
    and has_permission(account_id, 'recalls_access')
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and patient_id in (select my_own_patient_ids()))
    )
  );

-- Who is waiting at a clinic, without saying who. SECURITY DEFINER because
-- the point is to see entries whose patients the caller cannot; it returns no
-- patient_id for exactly that reason. RLS does not reach a definer function,
-- so the two things the policies would have checked are checked here: the
-- caller belongs to the clinic's account, and has passed two-factor where
-- two-factor applies.
create or replace function public.waitlist_waiting_in_clinic(p_clinic_id uuid)
returns table (id uuid, created_at timestamptz, appointment_type_id uuid, practitioner_id uuid, appointment_type_name text, practitioner_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select w.id, w.created_at, w.appointment_type_id, w.practitioner_id, at.name, tm.full_name
  from waitlist_entries w
  left join appointment_types at on at.id = w.appointment_type_id
  left join team_members tm on tm.id = w.practitioner_id
  where w.clinic_id = p_clinic_id
    and w.status = 'waiting'
    and w.account_id in (select my_member_account_ids())
    and (select mfa_satisfied())
  order by w.created_at;
$function$;

revoke all on function public.waitlist_waiting_in_clinic(uuid) from public, anon;
grant execute on function public.waitlist_waiting_in_clinic(uuid) to authenticated;
