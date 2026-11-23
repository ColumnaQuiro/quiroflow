-- "Is there a way to get a notice when a patient goes from 2 visits a week to
-- 1 a week in their care plan?" A plan can queue its next phases
-- (care_plans.next_phases, 20261113132000), and the next one starts by itself
-- once the last visit of the current one is done -- but nothing said so
-- beforehand. The patient kept being booked at the old cadence and the desk
-- found out at the counter, if at all.
--
-- So the last visit of a phase is now marked, the way a re-exam is
-- (care_plan_visit_markers, 20261020065508): "Visit 8 of the plan · last of
-- the phase, then weekly", on the calendar block, the appointment drawer and
-- the booking form. That visit is the moment to rebook at the new frequency.
-- The numbering is exactly the re-exam markers' -- the Nth appointment since
-- the plan started that is not cancelled, missed or deleted -- and the last
-- visit of the phase is the one numbered total_visits. These are the same
-- two functions, re-created with one more column; a plan's own markers
-- behave exactly as before.
--
-- Only a CHANGE of cadence is marked. A queued phase at the same cadence
-- changes nothing about how the patient is booked, and a marker on it would
-- teach the desk to ignore the marker.
--
-- And Care Plan Alerts gains "Changing frequency": the patients whose phase
-- ends at their next booked visit, or with at most one visit left, and who go
-- on to another cadence (care_plan_phase_changes below).
--
-- The phase-end rows are OPT-IN: p_with_phase_end, a trailing argument that
-- defaults to false, on both marker functions and on calendar_range_details,
-- which calls one of them for the calendar. This migration applies on merge
-- but the code reading it ships at the next release, and the code already
-- live names any marked visit without a label "Re-exam". So an existing call
-- gets exactly the rows it got before (next_phase is there, always null) and
-- only the new client, which passes true, sees the phase ends. Nothing is
-- removed: each function is re-created under its own name, and the old
-- call shapes still resolve to it.

-- The phase the plan goes on to, when it goes on to another cadence; else
-- null. Mirrored by nextCadenceChange in utils/carePlanPhases.ts.
create or replace function public.care_plan_cadence_change(
  p_visits_per_period integer,
  p_frequency_value integer,
  p_frequency_unit text,
  p_total_visits integer,
  p_next_phases jsonb
)
returns jsonb
language sql
immutable
as $function$
  select case
    when p_total_visits is not null
     and jsonb_typeof(p_next_phases) = 'array'
     and jsonb_array_length(p_next_phases) > 0
     and (
       (p_next_phases->0->>'visits_per_period')::integer is distinct from coalesce(p_visits_per_period, 1)
       or (p_next_phases->0->>'frequency_value')::integer is distinct from p_frequency_value
       or (p_next_phases->0->>'frequency_unit') is distinct from p_frequency_unit
     )
    then p_next_phases->0
  end;
$function$;

-- ---------------------------------------------------------------------------
-- care_plan_marked_visits: as in 20261020065508, plus next_phase. With
-- p_with_phase_end it is set on the visit numbered total_visits when the plan
-- goes on to another cadence, and a plan with no markers of its own numbers
-- its visits too when it has such a phase queued; the row it returns has no
-- label and no type, so it is a highlight and never a mismatch. Without it
-- (the default, and every call already live), phase_change is null all the
-- way through and the rows are exactly the old ones.
drop function if exists public.care_plan_marked_visits(timestamptz, timestamptz, uuid);
create function public.care_plan_marked_visits(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_patient_id uuid default null,
  p_with_phase_end boolean default false
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
  mismatch boolean,
  next_phase jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with latest as (
    select distinct on (cp.patient_id)
           cp.id, cp.account_id, cp.patient_id, cp.started_at, cp.visit_markers, cp.total_visits,
           case when p_with_phase_end
             then public.care_plan_cadence_change(cp.visits_per_period, cp.frequency_value, cp.frequency_unit, cp.total_visits, cp.next_phases)
           end as phase_change
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
    select a.id, a.patient_id, l.id as care_plan_id, l.account_id, l.visit_markers, l.total_visits, l.phase_change,
           a.starts_at, a.status, a.appointment_type_id,
           row_number() over (partition by a.patient_id order by a.starts_at, a.id)::integer as n
    from latest l
    join appointments a
      on a.patient_id = l.patient_id
     and a.deleted_at is null
     and a.status not in ('cancelled', 'no_show')
     and a.starts_at >= l.started_at
    where l.visit_markers <> '[]'::jsonb or l.phase_change is not null
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
         t.id is not null and nb.appointment_type_id is distinct from t.id,
         case when nb.n = nb.total_visits then nb.phase_change end
  from numbered nb
  cross join lateral (select public.care_plan_marker_for(nb.visit_markers, nb.n) as m) mk
  -- The type must be the clinic's own: the id is only text in a jsonb.
  left join appointment_types t on t.id = (mk.m->>'appointment_type_id')::uuid and t.account_id = nb.account_id
  where (mk.m is not null or (nb.phase_change is not null and nb.n = nb.total_visits))
    and (p_from is null or nb.starts_at >= p_from)
    and (p_to is null or nb.starts_at < p_to);
$function$;

-- ---------------------------------------------------------------------------
-- care_plan_visit_markers_at: as in 20261020065508, plus next_phase, for the
-- booking form -- so booking the last visit of a phase says what comes after.
-- Opt-in the same way, for the same reason.
drop function if exists public.care_plan_visit_markers_at(uuid, timestamptz[], uuid);
create function public.care_plan_visit_markers_at(
  p_patient_id uuid,
  p_starts_at timestamptz[],
  p_exclude_appointment_id uuid default null,
  p_with_phase_end boolean default false
)
returns table (
  starts_at timestamptz,
  visit_number integer,
  label text,
  expected_appointment_type_id uuid,
  expected_type_name text,
  next_phase jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with plan as (
    select cp.id, cp.account_id, cp.started_at, cp.visit_markers, cp.total_visits,
           case when p_with_phase_end
             then public.care_plan_cadence_change(cp.visits_per_period, cp.frequency_value, cp.frequency_unit, cp.total_visits, cp.next_phases)
           end as phase_change
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
           pl.total_visits,
           pl.phase_change,
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
    where pl.visit_markers <> '[]'::jsonb or pl.phase_change is not null
  )
  select n.at, n.visit_number, nullif(btrim(mk.m->>'label'), ''), t.id, t.name,
         case when n.visit_number = n.total_visits then n.phase_change end
  from n
  cross join lateral (select public.care_plan_marker_for(n.visit_markers, n.visit_number) as m) mk
  left join appointment_types t on t.id = (mk.m->>'appointment_type_id')::uuid and t.account_id = n.account_id
  where mk.m is not null or (n.phase_change is not null and n.visit_number = n.total_visits)
  order by n.at;
$function$;

-- ---------------------------------------------------------------------------
-- Care Plan Alerts › Changing frequency. One row per patient whose current
-- plan goes on to another cadence and whose phase is about to end: at most
-- one completed visit left, or the next booked visit is the phase's last (or
-- past it). With the last visit of the phase, numbered as above, and how many
-- visits are already booked beyond it -- booked at the old cadence, and so
-- the ones to move.
--
-- SECURITY DEFINER for the reason care_plan_marked_visits is: the numbering
-- has to see every visit the patient has, including a colleague's. So it
-- makes the same checks RLS would -- member accounts, two-factor, patient
-- scope -- and returns ids, numbers and the plan's cadence, never a visit's
-- contents or a patient's name: the page reads those under its own policies.
-- Being caller-scoped, it returns nothing to the service role (no member
-- accounts), which is fine for a staff page and wrong for a cron.
create or replace function public.care_plan_phase_changes()
returns table (
  patient_id uuid,
  care_plan_id uuid,
  care_plan_name text,
  visits_per_period integer,
  frequency_value integer,
  frequency_unit text,
  total_visits integer,
  completed_in_plan integer,
  next_phase jsonb,
  last_visit_appointment_id uuid,
  last_visit_starts_at timestamptz,
  last_visit_status text,
  booked_after_last integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with latest as (
    select distinct on (cp.patient_id)
           cp.id, cp.patient_id, cp.name, cp.started_at,
           cp.visits_per_period::integer as visits_per_period,
           cp.frequency_value::integer as frequency_value,
           cp.frequency_unit,
           cp.total_visits::integer as total_visits,
           public.care_plan_cadence_change(cp.visits_per_period, cp.frequency_value, cp.frequency_unit, cp.total_visits, cp.next_phases) as phase_change
    from care_plans cp
    where cp.account_id in (select my_member_account_ids())
      and (select mfa_satisfied())
      and (
        (select my_patients_scope()) = 'all'
        or ((select my_patients_scope()) = 'own' and cp.patient_id in (select my_own_patient_ids()))
      )
    order by cp.patient_id, cp.created_at desc
  ),
  changing as (
    select l.*
    from latest l
    where l.phase_change is not null
      and exists (select 1 from patients p where p.id = l.patient_id and p.status = 'active')
  ),
  numbered as (
    select a.id, a.patient_id, a.starts_at, a.status,
           row_number() over (partition by a.patient_id order by a.starts_at, a.id)::integer as n
    from changing c
    join appointments a
      on a.patient_id = c.patient_id
     and a.deleted_at is null
     and a.status not in ('cancelled', 'no_show')
     and a.starts_at >= c.started_at
  )
  select c.patient_id,
         c.id,
         c.name,
         c.visits_per_period,
         c.frequency_value,
         c.frequency_unit,
         c.total_visits,
         d.done,
         c.phase_change,
         lv.id,
         lv.starts_at,
         lv.status,
         ba.n
  from changing c
  -- Completed since the plan started: what care_plan_start_next_phase counts.
  cross join lateral (
    select count(*)::integer as done
    from numbered nb
    where nb.patient_id = c.patient_id and nb.status = 'completed'
  ) d
  left join lateral (
    select nb.id, nb.starts_at, nb.status from numbered nb where nb.patient_id = c.patient_id and nb.n = c.total_visits
  ) lv on true
  cross join lateral (
    select count(*)::integer as n from numbered nb where nb.patient_id = c.patient_id and nb.n > c.total_visits and nb.status = 'booked'
  ) ba
  left join lateral (
    select nb.n from numbered nb
    where nb.patient_id = c.patient_id and nb.status = 'booked' and nb.starts_at >= now()
    order by nb.starts_at, nb.id
    limit 1
  ) nx on true
  where c.total_visits - d.done <= 1
     or nx.n >= c.total_visits;
$function$;

revoke all on function public.care_plan_marked_visits(timestamptz, timestamptz, uuid, boolean) from public, anon;
revoke all on function public.care_plan_visit_markers_at(uuid, timestamptz[], uuid, boolean) from public, anon;
revoke all on function public.care_plan_phase_changes() from public, anon;
grant execute on function public.care_plan_marked_visits(timestamptz, timestamptz, uuid, boolean) to authenticated;
grant execute on function public.care_plan_visit_markers_at(uuid, timestamptz[], uuid, boolean) to authenticated;
grant execute on function public.care_plan_phase_changes() to authenticated;

-- ---------------------------------------------------------------------------
-- calendar_range_details: exactly as in 20261120093315, but passing
-- p_with_phase_end through to care_plan_marked_visits. Dropped and re-created
-- rather than overloaded, so PostgREST has one function to choose and the
-- call already live (six arguments, by name) resolves to it unchanged.
drop function if exists public.calendar_range_details(uuid, uuid, timestamptz, timestamptz, uuid[], uuid[]);
create function public.calendar_range_details(
  p_clinic_id uuid,
  p_account_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_appointment_ids uuid[],
  p_patient_ids uuid[],
  p_with_phase_end boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'visit_payments', public.visit_payment_rows(p_appointment_ids),
    -- Newest first: the client takes each patient's first pack with sessions left.
    'package_purchases', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.purchased_at desc) from (
        select patient_id, package_name, sessions_total, sessions_used, is_closed, purchased_at
        from package_purchases
        where patient_id = any(p_patient_ids)
      ) pp
    ), '[]'::jsonb),
    -- The live bonos SHARED with these patients (package_purchase_shares,
    -- a family bono), under the same caller policies. A separate key so the
    -- code already live, which reads package_purchases as each patient's
    -- own, is unchanged by it. Only live ones -- open, sessions left --
    -- since a shared bono is never history the calendar draws; one shared
    -- back with its own owner would count twice, so it is left out.
    'shared_package_purchases', coalesce((
      select jsonb_agg(to_jsonb(sp) order by sp.purchased_at desc) from (
        select s.patient_id, pp.package_name, pp.sessions_total, pp.sessions_used, pp.is_closed, pp.purchased_at
        from package_purchase_shares s
        join package_purchases pp on pp.id = s.package_purchase_id
        where s.account_id = p_account_id
          and s.patient_id = any(p_patient_ids)
          and pp.patient_id <> s.patient_id
          and not pp.is_closed
          and pp.sessions_used < pp.sessions_total
      ) sp
    ), '[]'::jsonb),
    -- One row per move of a visit in the range; the client counts them.
    'reschedules', coalesce((
      select jsonb_agg(jsonb_build_object('appointment_id', r.appointment_id))
      from appointment_reschedules r
      where r.appointment_id = any(p_appointment_ids)
    ), '[]'::jsonb),
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object('patient_id', b.patient_id, 'outstanding_cents', b.outstanding_cents))
      from patient_live_balances b
      where b.patient_id = any(p_patient_ids)
    ), '[]'::jsonb),
    -- At most two per patient (see the header): not cancelled, not deleted
    -- (deleting leaves the row, still 'booked'), from now on.
    'future_appointments', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'patient_id', f.patient_id))
      from (select distinct unnest(p_patient_ids) as patient_id) ids
      cross join lateral (
        select a.id, a.patient_id
        from appointments a
        where a.patient_id = ids.patient_id
          and a.status <> 'cancelled'
          and a.deleted_at is null
          and a.starts_at > now()
        limit 2
      ) f
    ), '[]'::jsonb),
    -- Moves OUT of a slot in the range: where the faded markers are drawn.
    'moves', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'appointment_id', r.appointment_id, 'from_starts_at', r.from_starts_at))
      from appointment_reschedules r
      where r.account_id = p_account_id
        and r.from_starts_at >= p_from
        and r.from_starts_at < p_to
    ), '[]'::jsonb),
    'waitlist_offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'offered_starts_at', w.offered_starts_at,
        'offered_ends_at', w.offered_ends_at,
        'offered_room_id', w.offered_room_id,
        'offered_practitioner_id', w.offered_practitioner_id,
        'offer_expires_at', w.offer_expires_at,
        'patients', (select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) from patients p where p.id = w.patient_id)
      ))
      from waitlist_entries w
      where w.clinic_id = p_clinic_id
        and w.status = 'offered'
        and w.offered_starts_at >= p_from
        and w.offered_starts_at < p_to
    ), '[]'::jsonb),
    -- The care plans' re-exam visits (20261020065508), as that function
    -- returns them -- and the last visits of a phase, for a caller that asks.
    'visit_markers', coalesce((
      select jsonb_agg(to_jsonb(m)) from public.care_plan_marked_visits(p_from, p_to, null, p_with_phase_end) m
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_range_details(uuid, uuid, timestamptz, timestamptz, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.calendar_range_details(uuid, uuid, timestamptz, timestamptz, uuid[], uuid[], boolean) to authenticated, service_role;
