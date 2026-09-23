-- Two computed fields on patients, so the patient list can filter by balance
-- and search by phone in the database rather than by sending id lists.
--
-- Both filters used to work by fetching the matching patient ids first and
-- passing them back as `id=in.(...)`. That filter travels in the URL, and the
-- API gateway refuses a request line past about 8 KB with 414 URI Too Long --
-- roughly 215 uuids. A refused request reaches supabase-js as `data: null`,
-- which the page renders as "no patients", with no error anywhere.
--
-- Production had already crossed it on 23 Sep 2026: the largest account has
-- 221 patients in credit, so the "In credit" filter showed nobody, and a
-- one-digit phone search ("6", 1,467 matches) emptied the list the same way.
-- Neither can be chunked, because both feed a paginated, counted query.
--
-- PostgREST exposes a function taking the table's row type as a computed
-- field: filterable like a column (`live_balance_cents=lt.0`), usable inside
-- or=(...), and only computed when referenced.

-- Reads the view rather than repeating its arithmetic, so the list's filter
-- and the balance shown in the same row cannot disagree. security invoker
-- (the default) keeps the view's RLS in force.
create or replace function public.live_balance_cents(p public.patients)
returns integer
language sql
stable
set search_path = public
as $$
  select b.balance_cents from patient_live_balances b where b.patient_id = p.id
$$;

-- Every number on file, space-separated. A search token never contains
-- whitespace (the page splits on it), so a match cannot straddle two numbers.
create or replace function public.phone_numbers_text(p public.patients)
returns text
language sql
stable
set search_path = public
as $$
  select string_agg(n.number, ' ') from patient_contact_numbers n where n.patient_id = p.id
$$;

revoke all on function public.live_balance_cents(public.patients) from anon, public;
revoke all on function public.phone_numbers_text(public.patients) from anon, public;
grant execute on function public.live_balance_cents(public.patients) to authenticated, service_role;
grant execute on function public.phone_numbers_text(public.patients) to authenticated, service_role;
