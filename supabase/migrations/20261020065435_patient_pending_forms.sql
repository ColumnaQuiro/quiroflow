-- How many forms a patient was sent and has not completed yet, so the
-- calendar can warn the front desk before the visit. Clinics report that a
-- patient who has not done their intake forms and is not answering the phone
-- usually does not turn up -- and until now the only place that status showed
-- was the patient's own Docs tab, which nobody opens from the calendar.
--
-- A computed field rather than a query of its own: PostgREST lets a function
-- taking a `patients` row be selected like a column, including inside an
-- embed, so the calendar asks for `patients(first_name, ..., pending_forms)`
-- in the appointments read it already makes. No extra request per range, and
-- none per appointment.
--
-- SECURITY INVOKER (the default), deliberately: the count runs under the
-- caller's RLS on patient_docs, so it says exactly what that person could see
-- by opening the Docs tab -- the own-docs scope, the patient scope and the
-- two-factor gate all apply, and a role that cannot see a form is not told it
-- exists.
--
-- "Pending" is what the Docs tab calls "Awaiting patient" (completed_at is
-- null), narrowed to documents that ask the patient something. A blank
-- document with no blocks, or one made only of headings and text, has nothing
-- to complete -- on the live database most pending documents were exactly
-- that, empty drafts that would otherwise flag their patient forever. The
-- PracticeHub import writes completed_at, so imported history is never
-- pending.
-- The count runs once per appointment on the grid -- a whole-clinic week is
-- a few hundred. Through patient_docs_patient_idx each call read every
-- document the patient has from the heap (0.18 ms a call on the live
-- database, most of a week's read) to throw nearly all of them away on
-- completed_at. Pending documents are a handful in the whole table, so this
-- index is tiny and most calls find nothing in it without touching the heap.
create index if not exists patient_docs_pending_idx
  on public.patient_docs (account_id, patient_id)
  where completed_at is null;

create or replace function public.pending_forms(p public.patients)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.patient_docs d
  where d.account_id = p.account_id
    and d.patient_id = p.id
    and d.completed_at is null
    -- A jsonpath rather than jsonb_array_elements: lax mode cannot raise on a
    -- `fields` that is not an array, and a raise here would fail the whole
    -- appointments read the calendar draws from, not just this count.
    and d.fields @? '$[*] ? (@.type != "heading" && @.type != "text")'
$$;

comment on function public.pending_forms(public.patients) is
  'Forms sent to the patient and not yet completed, as the caller can see them. Selected as a computed column: patients(pending_forms).';

revoke all on function public.pending_forms(public.patients) from public, anon;
grant execute on function public.pending_forms(public.patients) to authenticated, service_role;
