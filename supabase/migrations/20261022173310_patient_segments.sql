-- Patient segments: saved filters on the patient list ("bono almost used up",
-- "no future appointment and VIP", "owes money"), shared with the team or
-- private to whoever saved them. PracticeHub 2.0 has them beside "All
-- Patients"; QuiroFlow's list saved nothing, so the same filter was rebuilt
-- by hand every time.
--
-- Two parts:
--
--   * patients_matching(filters, clinic): every filter the patient list
--     offers, applied in the database. The list, its CSV export and the
--     segment counts all go through it, so a segment's count is the number
--     of rows opening it shows, and an export cannot disagree with the
--     screen. It returns patients rows, so PostgREST pages, orders and counts
--     it like the table (`rpc(...).select().order().range()` with
--     count=exact) and the filters travel in the POST body, not the URL --
--     the 414 at ~215 ids (20260923150000) cannot happen here.
--
--   * patient_segments: a name and the same filters object, as jsonb.
--
-- patients_matching is security invoker on purpose: the patients RLS policy
-- (practitioners scoped to their own patients, the two-factor restrictive
-- policy) decides who is in the result exactly as it does for the plain
-- table read the list used before. The per-patient subqueries read
-- appointments, bonos, care plans and app_opens under their own RLS too, the
-- same way patient_list_visit_summary does for the visible page.
--
-- It is plpgsql building its WHERE from only the filters that are set, run
-- with EXECUTE, rather than one SQL statement of `(x is null or ...)` guards:
-- EXECUTE plans each call with the real predicates, so the search still
-- reaches the trigram indexes (20261020063000) instead of a generic plan
-- that scans every patient -- the statement timeout #830 fixed.

create table public.patient_segments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The patient list's filter object (utils/patientFilters.ts), the same
  -- keys the page puts in its URL. Unknown keys are ignored by
  -- patients_matching, so a segment saved by a newer version of the app
  -- still opens on an older one.
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  -- Shared with the whole team, or seen only by its author.
  shared boolean not null default true,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patient_segments_account_idx on public.patient_segments (account_id, name);
create index patient_segments_created_by_idx on public.patient_segments (created_by);
select public.grant_data_api('public.patient_segments');

-- The author is whoever is signed in, whatever the client sent: a private
-- segment is private to created_by, so it cannot be left to the request.
create or replace function public.patient_segments_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(
      (select i.team_member_id from public.my_team_member_identities() i where i.account_id = new.account_id limit 1),
      new.created_by
    );
  else
    new.created_by := old.created_by;
    new.account_id := old.account_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.patient_segments_stamp() from public, anon, authenticated;
create trigger patient_segments_stamp before insert or update on public.patient_segments
  for each row execute function public.patient_segments_stamp();

alter table public.patient_segments enable row level security;

-- Shared segments are the team's; a private one only its author's.
create policy "staff select patient_segments" on public.patient_segments for select
  using (
    account_id in (select public.my_member_account_ids())
    and (shared or (account_id, created_by) in (select * from public.my_team_member_identities()))
  );
create policy "staff insert patient_segments" on public.patient_segments for insert
  with check ((account_id, created_by) in (select * from public.my_team_member_identities()));
-- The author can always rename or delete their own. A shared one belongs to
-- the team, so anyone who can edit patients can tidy it up; the activity log
-- records who did.
create policy "staff update patient_segments" on public.patient_segments for update
  using (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  )
  with check (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  );
create policy "staff delete patient_segments" on public.patient_segments for delete
  using (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  );
select public.require_two_factor_on('public.patient_segments');

-- Adds 'patient_segment' to whatever the constraint allows when this runs,
-- rather than restating the whole list. Several branches are adding entity
-- types at once (reasons for stopping care adds two), and a restated list
-- silently drops the types of every migration that ran before it but was
-- written without it.
do $$
declare
  v_types text[];
begin
  -- The definition reads either ARRAY['a'::text, ...] or '{a,b}'::text[]
  -- (what this block writes); the lower-case words in it are the types,
  -- the column and the cast.
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['patient_segment']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_patient_segments after insert or update or delete on public.patient_segments
  for each row execute function public.fn_audit_log('patient_segment', 'updated_at');

-- The filters. Each key is optional; an absent key filters nothing, except
-- status, which defaults to active as the list always has.
--
--   status            'active' | 'inactive' | 'any'
--   q                 search text: every word must match name, email, NIF or phone
--   tags              text[]: has all of them
--   practitioner      uuid: default practitioner
--   clinic            uuid | 'all'; absent = p_clinic_id (the sidebar's clinic)
--   lastVisitFrom/To  date, inclusive: last completed visit in that range
--   futureAppointment 'yes' | 'no': a booked visit after now
--   bono              'active' | 'none': a live bono (own or shared, not closed, sessions left)
--   bonoSessionsMax   int: with bono=active, sessions left across live bonos <= N
--   balance           'owing' | 'credit'
--   createdFrom/To    date, inclusive
--   app               'yes' | 'no': a device has run the app signed in as them
--   birthdayThisMonth true
--   carePlan          'on'
--   missingContact    'email' | 'phone'
--   doNotContact      true
--   minors            true
--
-- Dates are the clinic's calendar days (clinics.timezone), not UTC ones.
--
-- Custom patient attributes are meant to join this list as one more key
-- (say `attributes`: [{id, op, value}]) adding one predicate below; nothing
-- else -- the table, the counts, the URL -- needs to change for it.
create or replace function public.patients_matching(p_filters jsonb default '{}'::jsonb, p_clinic_id uuid default null)
returns setof public.patients
language plpgsql
stable
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  w text[] := array[]::text[];
  v_status text := coalesce(nullif(f->>'status', ''), 'active');
  v_clinic text := nullif(f->>'clinic', '');
  v_clinic_id uuid;
  v_tz text;
  v_tags text[];
  v_token text;
  v_like text;
  v_last_visit text := '(select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status = ''completed'' and a.deleted_at is null)';
  v_bono_left text := '(select coalesce(sum(pp.sessions_total - pp.sessions_used), 0) from package_purchases pp'
    || ' where not pp.is_closed and pp.sessions_used < pp.sessions_total'
    || ' and pp.id in (select o.id from package_purchases o where o.patient_id = p.id'
    || ' union all select s.package_purchase_id from package_purchase_shares s where s.patient_id = p.id))';
begin
  -- Which clinic. The sidebar's clinic unless the filter names another, or
  -- 'all' for every clinic the person can see.
  if v_clinic is null then
    v_clinic_id := p_clinic_id;
  elsif v_clinic <> 'all' then
    v_clinic_id := v_clinic::uuid;
  end if;
  if v_clinic_id is not null then
    w := w || format('p.clinic_id = %L', v_clinic_id);
  end if;
  select c.timezone into v_tz from clinics c where c.id = coalesce(v_clinic_id, p_clinic_id);
  v_tz := coalesce(nullif(v_tz, ''), 'Europe/Madrid');

  if v_status in ('active', 'inactive') then
    w := w || format('p.status = %L', v_status);
  end if;

  if nullif(f->>'practitioner', '') is not null then
    w := w || format('p.default_practitioner_id = %L', (f->>'practitioner')::uuid);
  end if;

  if jsonb_typeof(f->'tags') = 'array' then
    select array_agg(t) into v_tags from jsonb_array_elements_text(f->'tags') t where t <> '';
    if v_tags is not null then
      w := w || format('p.tags @> %L::text[]', v_tags);
    end if;
  end if;

  if nullif(f->>'lastVisitFrom', '') is not null then
    w := w || format('%s >= (%L::date)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitFrom')::date, v_tz);
  end if;
  if nullif(f->>'lastVisitTo', '') is not null then
    w := w || format('%s < ((%L::date) + 1)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitTo')::date, v_tz);
  end if;

  -- Same definition as the list's Next visit column (patient_list_visit_summary).
  if f->>'futureAppointment' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from appointments a where a.patient_id = p.id and a.status = ''booked'' and a.starts_at > now() and a.deleted_at is null)',
      case when f->>'futureAppointment' = 'no' then 'not' else '' end
    );
  end if;

  -- A live bono is what the Billing tab offers sessions from: own or shared,
  -- not closed in PracticeHub (20260923120702), with sessions left.
  if f->>'bono' = 'active' then
    w := w || format('%s > 0', v_bono_left);
    if nullif(f->>'bonoSessionsMax', '') is not null then
      w := w || format('%s <= %s', v_bono_left, greatest((f->>'bonoSessionsMax')::int, 0));
    end if;
  elsif f->>'bono' = 'none' then
    w := w || format('%s = 0', v_bono_left);
  end if;

  -- Owing asks the invoices, In credit the balance -- two different columns
  -- on purpose; see 20260923160000 and utils/owing.ts. Read from the view as
  -- one set, not through live_outstanding_cents(p) per row: on 3,300
  -- patients the computed field took 7.6 s (the view recomputed once per
  -- patient) and the set 80 ms. Same view, same RLS, same numbers.
  if f->>'balance' = 'owing' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.outstanding_cents > 0)'::text;
  elsif f->>'balance' = 'credit' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.balance_cents > 0)'::text;
  end if;

  if nullif(f->>'createdFrom', '') is not null then
    w := w || format('p.created_at >= (%L::date)::timestamp at time zone %L', (f->>'createdFrom')::date, v_tz);
  end if;
  if nullif(f->>'createdTo', '') is not null then
    w := w || format('p.created_at < ((%L::date) + 1)::timestamp at time zone %L', (f->>'createdTo')::date, v_tz);
  end if;

  -- What the patient banner calls "has the app" (components/patients/AppStatus.vue).
  if f->>'app' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from app_opens o where o.account_id = p.account_id and o.user_id = p.user_id)',
      case when f->>'app' = 'no' then 'not' else '' end
    );
  end if;

  if f->>'birthdayThisMonth' = 'true' then
    w := w || format('extract(month from p.date_of_birth) = extract(month from now() at time zone %L)', v_tz);
  end if;

  if f->>'carePlan' = 'on' then
    w := w || 'exists (select 1 from care_plans cp where cp.patient_id = p.id)'::text;
  end if;

  if f->>'missingContact' = 'email' then
    w := w || '(p.email is null or p.email = '''')'::text;
  elsif f->>'missingContact' = 'phone' then
    w := w || 'not p.has_phone'::text;
  end if;

  if f->>'doNotContact' = 'true' then
    w := w || 'p.do_not_contact'::text;
  end if;
  if f->>'minors' = 'true' then
    w := w || 'p.is_minor'::text;
  end if;

  -- Every word must match one of the four, as the list's search always has.
  -- LIKE's own wildcards and escape are taken out of what was typed.
  for v_token in
    select regexp_replace(x, '[%_\\,()]', '', 'g') from regexp_split_to_table(btrim(coalesce(f->>'q', '')), '\s+') x
  loop
    continue when v_token = '';
    v_like := '%' || v_token || '%';
    w := w || format(
      '(p.search_name ilike %L or p.email ilike %L or p.national_id ilike %L or p.phone_search ilike %L)',
      '%' || unaccent_lower(v_token) || '%', v_like, v_like, v_like
    );
  end loop;

  return query execute 'select p.* from patients p where '
    || coalesce(nullif(array_to_string(w, ' and '), ''), 'true');
end;
$$;

revoke all on function public.patients_matching(jsonb, uuid) from public, anon;
grant execute on function public.patients_matching(jsonb, uuid) to authenticated, service_role;

-- Every segment the caller can see, with how many patients opening it would
-- show right now, in one round trip.
create or replace function public.patient_segment_counts(p_clinic_id uuid default null)
returns table (segment_id uuid, patient_count bigint)
language sql
stable
set search_path = public
as $$
  select s.id,
         (select count(*) from public.patients_matching(s.filters, p_clinic_id) m where m.account_id = s.account_id)
  from public.patient_segments s
$$;

revoke all on function public.patient_segment_counts(uuid) from public, anon;
grant execute on function public.patient_segment_counts(uuid) to authenticated, service_role;

-- The tags in use, most used first, for the list's tag filter. Tags are free
-- text typed on each record; there is no list of them anywhere else.
create or replace function public.patient_tags()
returns table (tag text, patient_count bigint)
language sql
stable
set search_path = public
as $$
  select t, count(*)
  from patients p, unnest(p.tags) t
  where t <> ''
  group by t
  order by count(*) desc, t
$$;

revoke all on function public.patient_tags() from public, anon;
grant execute on function public.patient_tags() to authenticated, service_role;
