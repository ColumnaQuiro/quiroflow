-- Three read paths on appointments that cost far more than what they return,
-- measured on production on 23 Nov 2026.
--
-- 1. Staff reading appointment types or practitioners paid for the PATIENT
--    policy on every other clinic's row.
--
--    "patients read types of own appointments" was a correlated EXISTS: for
--    each appointment_types row, look for an appointment of that type whose
--    patient is one I can act for. Permissive policies are OR'd, so a row the
--    staff policy already let through never reached it -- but every row it did
--    NOT let through, which is every other clinic's, did. For a staff user the
--    answer is always no, and finding that out meant walking all of that
--    type's appointments:
--
--      Seq Scan on appointment_types (actual rows=6)
--        Rows Removed by Filter: 63
--        Buffers: shared hit=10737          -- to return 6 rows, 47 ms
--        SubPlan 10 -> Index Scan using appointments_appointment_type_id_idx
--                        (loops=62) Rows Removed by Filter: 1019
--
--    calendar_reference() reads both tables with no other filter and averaged
--    248 ms and 33,000 buffers a call, and the cost grew with every clinic
--    onboarded and every appointment they booked, not with the caller's own.
--
--    Turned round, the subquery no longer mentions the outer row, so it runs
--    once per query instead of once per row, and starts from the patients
--    rather than from the type. `= any (array(...))` and not `in (select ...)`
--    on purpose: against a set-returning function the planner guesses 1,000
--    patients and picks a hash join over a sequential scan of appointments;
--    an array it scans by appointments_patient_idx (38 rows, 6 ms for a real
--    patient; nothing at all for staff, whose array is empty).
--
--    Who can read what is unchanged: the inner select is still subject to the
--    caller's own policies on appointments, exactly as before.
alter policy "patients read types of own appointments" on public.appointment_types
  using (id in (select a.appointment_type_id from public.appointments a
                where a.patient_id = any (array(select public.patients_i_can_act_for()))));

alter policy "patients read practitioners of own appointments" on public.team_members
  using (id in (select a.practitioner_id from public.appointments a
                where a.patient_id = any (array(select public.patients_i_can_act_for()))));

-- 2. "My day" in the navigation badges counted one practitioner's appointments
--    for one day by reading every appointment that practitioner has ever had
--    (appointments_practitioner_id_idx, then a filter on starts_at): tens of
--    thousands of rows for a count of twenty, on every badge refresh. With
--    starts_at in the index it reads the day and nothing else. The new index
--    leads with practitioner_id, so it serves everything the old one did,
--    the foreign key included.
create index if not exists appointments_practitioner_starts_at_idx
  on public.appointments (practitioner_id, starts_at);
drop index if exists public.appointments_practitioner_id_idx;

-- 3. The importers read an account's appointments a page at a time
--    (`account_id = $1 and external_reference like 'PH-%' order by id limit
--    1000 offset N`). Nothing was indexed by account in id order, so each page
--    walked appointments_pkey across every clinic's rows: ~70,000 buffers a
--    page, sixty pages a sync, six at a time. With the reference carried in
--    the index, the pages that ask only for id and external_reference never
--    touch the table (57,000 buffers -> 465 on a copy of the same shape).
--    Pages that ask for more columns still fetch the rows they skip; that is
--    the offset paging itself and needs the importer changed, not an index.
create index if not exists appointments_account_id_id_idx
  on public.appointments (account_id, id) include (external_reference);
