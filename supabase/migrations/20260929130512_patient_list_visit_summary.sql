-- Last visit, visit count and next visit for a page of the patient list, one
-- row per patient.
--
-- The list used to fetch these as rows: every completed appointment of the 50
-- patients on the page (for the count and the newest date), and every future
-- booking (for the soonest). A select stops at PostgREST's max_rows -- 1000 --
-- silently, no error. Fifty long-standing patients pass that easily (twenty
-- visits each is enough), and what fell past the cut simply was not there:
-- care-plan progress undercounted, and a patient whose visits were all beyond
-- row 1000 read "Never" in Last visit. It was also the page's largest
-- transfer, for three numbers per patient.
--
-- Aggregated here instead, so the answer is one row per patient whatever the
-- history. The filters are exactly the ones the list applied to its rows --
-- completed for the count and last visit, booked and still ahead for the next
-- one -- so the figures do not move.
--
-- security invoker (the default) keeps appointments' RLS in force, the same
-- rows the list could read before. Taken as an array in the request body
-- rather than an id list in the URL, which has its own ~8 KB limit.
create or replace function public.patient_list_visit_summary(p_patient_ids uuid[])
returns table (patient_id uuid, last_visit_at timestamptz, completed_count integer, next_visit_at timestamptz)
language sql
stable
set search_path = public
as $$
  select a.patient_id,
         max(a.starts_at) filter (where a.status = 'completed'),
         (count(*) filter (where a.status = 'completed'))::integer,
         min(a.starts_at) filter (where a.status = 'booked' and a.starts_at > now())
  from appointments a
  where a.patient_id = any(p_patient_ids)
  group by a.patient_id
$$;

revoke all on function public.patient_list_visit_summary(uuid[]) from anon, public;
grant execute on function public.patient_list_visit_summary(uuid[]) to authenticated, service_role;
