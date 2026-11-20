-- The calendar's bono chip and hover card count the bonos SHARED with a
-- patient, not only their own.
--
-- calendar_range_details and appointment_panel (20261111192100) read
-- package_purchases where patient_id = the patient, so a bono that lives on
-- a parent and is shared with a child (package_purchase_shares, 0076) never
-- reached the block. On 20 Nov 2026 that was 156 patients whose block showed
-- no bono at all although the checkout offers one, and 4 who hold two or
-- more live bonos -- for whom the block named one when the checkout leaves
-- the choice to the front desk (#1231).
--
-- Both functions gain one key, shared_package_purchases, and change nothing
-- else: same arguments, same keys, same rows under them. Code already live
-- ignores a key it does not read, so this is safe in the window between the
-- merge (which applies it) and the release that reads it.

create or replace function public.calendar_range_details(
  p_clinic_id uuid,
  p_account_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_appointment_ids uuid[],
  p_patient_ids uuid[]
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
    -- The care plans' re-exam visits (20261020065508), as that function returns them.
    'visit_markers', coalesce((
      select jsonb_agg(to_jsonb(m)) from public.care_plan_marked_visits(p_from, p_to) m
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_range_details(uuid, uuid, timestamptz, timestamptz, uuid[], uuid[]) from public, anon;
grant execute on function public.calendar_range_details(uuid, uuid, timestamptz, timestamptz, uuid[], uuid[]) to authenticated, service_role;

create or replace function public.appointment_panel(p_appointment_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with appt as (
    select id, patient_id from appointments where id = p_appointment_id
  )
  select jsonb_build_object(
    'visit_payments', public.visit_payment_rows(array[p_appointment_id]),
    'balance', (
      select jsonb_build_object('outstanding_cents', b.outstanding_cents)
      from patient_live_balances b
      join appt on appt.patient_id = b.patient_id
    ),
    'package_purchases', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.purchased_at desc) from (
        select pu.package_name, pu.sessions_total, pu.sessions_used, pu.is_closed, pu.purchased_at
        from package_purchases pu
        join appt on appt.patient_id = pu.patient_id
      ) pp
    ), '[]'::jsonb),
    -- As calendar_range_details: the live bonos shared with the patient.
    'shared_package_purchases', coalesce((
      select jsonb_agg(to_jsonb(sp) order by sp.purchased_at desc) from (
        select pp.package_name, pp.sessions_total, pp.sessions_used, pp.is_closed, pp.purchased_at
        from package_purchase_shares s
        join appt on appt.patient_id = s.patient_id
        join package_purchases pp on pp.id = s.package_purchase_id
        where pp.patient_id <> s.patient_id
          and not pp.is_closed
          and pp.sessions_used < pp.sessions_total
      ) sp
    ), '[]'::jsonb),
    'reschedule_count', (select count(*) from appointment_reschedules r where r.appointment_id = p_appointment_id),
    -- The calendar's rule for "has a next visit": any visit not cancelled or
    -- deleted, from now on, other than this one.
    'has_later_visit', exists (
      select 1
      from appointments a
      join appt on appt.patient_id = a.patient_id
      where a.status <> 'cancelled'
        and a.deleted_at is null
        and a.starts_at > now()
        and a.id <> appt.id
    ),
    'overrides', coalesce((
      select jsonb_agg(to_jsonb(o)) from (
        select appointment_type_id, team_member_id, duration_minutes, price_cents
        from appointment_type_overrides
      ) o
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'summary', l.summary,
        'created_at', l.created_at,
        'actor', l.actor,
        'team_members', (select jsonb_build_object('full_name', m.full_name) from team_members m where m.id = l.team_member_id)
      ) order by l.created_at)
      from audit_logs l
      where l.entity_type = 'appointment'
        and l.entity_id = p_appointment_id
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.appointment_panel(uuid) from public, anon;
grant execute on function public.appointment_panel(uuid) to authenticated, service_role;
