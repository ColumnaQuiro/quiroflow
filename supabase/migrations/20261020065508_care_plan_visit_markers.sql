-- Re-exam visits on a care plan. A plan could say "2 visits a week for 12
-- visits" but not "every 12th visit is a re-exam", so the visit that should
-- have been a review was booked like any other -- and when a patient moved
-- visits 11 and 12 around, the scans and the review landed on the wrong
-- slots with nothing to say so.
--
-- A plan now carries a short list of markers, each one either
--
--   {"at": 3}                         visit 3, once
--   {"at": 12, "every": 12}           visits 12, 24, 36...
--   {"at": 11, "every": 12, "appointment_type_id": "<scans>"}
--
-- with an optional label. A marker with an appointment type is a statement
-- about how that visit should be booked, and a visit booked as anything else
-- is a mismatch (care_plan_marked_visits.mismatch). One without a type only
-- highlights the visit -- the clinic that wants visit 3 to stand out without
-- inventing an appointment type for it gets that and no warnings.
--
-- Visits are counted, not dated: the Nth appointment since the plan started
-- that is not cancelled, missed or deleted, booked ones included, so moving
-- a visit renumbers the ones around it the way the clinic sees it. That is
-- also why it works on an open-ended maintenance plan with no fixed cadence,
-- and why the count does not stop at total_visits.
--
-- A column rather than a table: "Edit plan" inserts a new care_plans row
-- (a fresh phase), and the markers belong to the phase. No new table means
-- nothing new keyed to patients for merge_patients, anonymize_patient, RLS
-- or the two-factor policy to miss.

create or replace function public.care_plan_visit_markers_valid(p jsonb)
returns boolean
language plpgsql
immutable
as $function$
declare
  m jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then
    return false;
  end if;
  for m in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(m) <> 'object' then return false; end if;
    if jsonb_typeof(m->'at') is distinct from 'number' then return false; end if;
    if (m->>'at')::numeric <> trunc((m->>'at')::numeric) or (m->>'at')::numeric not between 1 and 999 then return false; end if;
    if coalesce(jsonb_typeof(m->'every'), 'null') <> 'null' then
      if jsonb_typeof(m->'every') <> 'number' then return false; end if;
      if (m->>'every')::numeric <> trunc((m->>'every')::numeric) or (m->>'every')::numeric not between 1 and 999 then return false; end if;
    end if;
    if coalesce(jsonb_typeof(m->'appointment_type_id'), 'null') <> 'null' then
      if jsonb_typeof(m->'appointment_type_id') <> 'string'
         or (m->>'appointment_type_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
      end if;
    end if;
    if coalesce(jsonb_typeof(m->'label'), 'null') <> 'null' then
      if jsonb_typeof(m->'label') <> 'string' or length(m->>'label') > 40 then return false; end if;
    end if;
  end loop;
  return true;
end;
$function$;

alter table public.care_plans
  add column visit_markers jsonb not null default '[]'::jsonb
  constraint care_plans_visit_markers_valid check (public.care_plan_visit_markers_valid(visit_markers));

-- The marker visit n falls on, or null: the first that matches, in the
-- plan's order. Mirrored by markerForVisit in utils/carePlanVisitMarkers.ts.
create or replace function public.care_plan_marker_for(p_markers jsonb, p_visit integer)
returns jsonb
language sql
immutable
as $function$
  select m.value
  from jsonb_array_elements(coalesce(p_markers, '[]'::jsonb)) with ordinality as m(value, ord)
  where p_visit >= (m.value->>'at')::integer
    and (
      p_visit = (m.value->>'at')::integer
      or (
        coalesce(jsonb_typeof(m.value->'every'), 'null') = 'number'
        and (p_visit - (m.value->>'at')::integer) % (m.value->>'every')::integer = 0
      )
    )
  order by m.ord
  limit 1;
$function$;

-- Every marked visit, numbered, for the caller's patients. SECURITY DEFINER
-- for the reason care_plan_visit_facts() is (20261003155100): numbering has
-- to see every visit the patient has, including ones with a colleague that
-- an 'own'-calendar practitioner cannot read. So it makes the same checks
-- RLS would -- member accounts, two-factor, patient scope -- and returns ids,
-- a number and the types, never a visit's contents.
create or replace function public.care_plan_marked_visits(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_patient_id uuid default null
)
returns table (
  appointment_id uuid,
  patient_id uuid,
  care_plan_id uuid,
  starts_at timestamptz,
  status text,
  visit_number integer,
  label text,
  expected_appointment_type_id uuid,
  expected_type_name text,
  appointment_type_id uuid,
  mismatch boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with latest as (
    select distinct on (cp.patient_id) cp.id, cp.account_id, cp.patient_id, cp.started_at, cp.visit_markers
    from care_plans cp
    where cp.account_id in (select my_member_account_ids())
      and (select mfa_satisfied())
      and (p_patient_id is null or cp.patient_id = p_patient_id)
      and (
        (select my_patients_scope()) = 'all'
        or ((select my_patients_scope()) = 'own' and cp.patient_id in (select my_own_patient_ids()))
      )
    order by cp.patient_id, cp.created_at desc
  ),
  numbered as (
    select a.id, a.patient_id, l.id as care_plan_id, l.account_id, l.visit_markers, a.starts_at, a.status, a.appointment_type_id,
           row_number() over (partition by a.patient_id order by a.starts_at, a.id)::integer as n
    from latest l
    join appointments a
      on a.patient_id = l.patient_id
     and a.deleted_at is null
     and a.status not in ('cancelled', 'no_show')
     and a.starts_at >= l.started_at
    where l.visit_markers <> '[]'::jsonb
  )
  select nb.id,
         nb.patient_id,
         nb.care_plan_id,
         nb.starts_at,
         nb.status,
         nb.n,
         nullif(btrim(mk.m->>'label'), ''),
         t.id,
         t.name,
         nb.appointment_type_id,
         -- A type since deleted leaves a highlight, not a warning nobody can clear.
         t.id is not null and nb.appointment_type_id is distinct from t.id
  from numbered nb
  cross join lateral (select public.care_plan_marker_for(nb.visit_markers, nb.n) as m) mk
  -- The type must be the clinic's own: the id is only text in a jsonb.
  left join appointment_types t on t.id = (mk.m->>'appointment_type_id')::uuid and t.account_id = nb.account_id
  where mk.m is not null
    and (p_from is null or nb.starts_at >= p_from)
    and (p_to is null or nb.starts_at < p_to);
$function$;

-- What visits booked for this patient at these times would be: each one's
-- number in the plan and its marker, for the ones that land on a marker.
-- For the booking form, before the appointments exist -- one time for a
-- single booking, every date of a series together, since each date of the
-- series moves the ones after it along. p_exclude_appointment_id: the
-- appointment being moved, which should not count against itself.
create or replace function public.care_plan_visit_markers_at(
  p_patient_id uuid,
  p_starts_at timestamptz[],
  p_exclude_appointment_id uuid default null
)
returns table (
  starts_at timestamptz,
  visit_number integer,
  label text,
  expected_appointment_type_id uuid,
  expected_type_name text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with plan as (
    select cp.id, cp.account_id, cp.started_at, cp.visit_markers
    from care_plans cp
    where cp.patient_id = p_patient_id
      and cp.account_id in (select my_member_account_ids())
      and (select mfa_satisfied())
      and (
        (select my_patients_scope()) = 'all'
        or ((select my_patients_scope()) = 'own' and cp.patient_id in (select my_own_patient_ids()))
      )
    order by cp.created_at desc
    limit 1
  ),
  wanted as (
    select distinct s.at from unnest(p_starts_at) as s(at) where s.at is not null
  ),
  n as (
    select w.at,
           pl.account_id,
           pl.visit_markers,
           1
           + (select count(*)::integer from wanted w2 where w2.at >= pl.started_at and w2.at < w.at)
           + (
             select count(*)::integer
             from appointments a
             where a.patient_id = p_patient_id
               and a.deleted_at is null
               and a.status not in ('cancelled', 'no_show')
               and a.starts_at >= pl.started_at
               and a.starts_at < w.at
               and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
           ) as visit_number
    from plan pl
    join wanted w on w.at >= pl.started_at
    where pl.visit_markers <> '[]'::jsonb
  )
  select n.at, n.visit_number, nullif(btrim(mk.m->>'label'), ''), t.id, t.name
  from n
  cross join lateral (select public.care_plan_marker_for(n.visit_markers, n.visit_number) as m) mk
  left join appointment_types t on t.id = (mk.m->>'appointment_type_id')::uuid and t.account_id = n.account_id
  where mk.m is not null
  order by n.at;
$function$;

revoke all on function public.care_plan_marked_visits(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.care_plan_visit_markers_at(uuid, timestamptz[], uuid) from public, anon;
grant execute on function public.care_plan_marked_visits(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.care_plan_visit_markers_at(uuid, timestamptz[], uuid) to authenticated;
