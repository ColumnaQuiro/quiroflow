-- The calendar's per-range detail, today's panels and one visit's panel, in
-- one request each.
--
-- The calendar is the screen reception lives in, and after
-- calendar_reference (20261018133323) a week still cost around twenty
-- requests: the appointments, then a fan-out keyed by their ids -- how each
-- visit was paid (two reads), each patient's packs, balance and future
-- visits, the moved counts, the moved-away markers, the waitlist offers, the
-- re-exam markers -- each of those split again into chunks of 150 ids so the
-- URL stayed under the gateway's limit. Every drag, flow step and panel save
-- repeated all of it. On production's two-core database a request costs
-- 50-100 ms before it does any work and requests fired together queue behind
-- each other, so the count is the cost.
--
-- These functions fold the transport and nothing else. Each is SECURITY
-- INVOKER and returns the same rows, same columns and same filters the
-- separate selects did, nested the way PostgREST embedded them, so the
-- caller's own policies decide what comes back exactly as before (a role
-- without billing access gets empty lists, not an error) and the TypeScript
-- that turns rows into what is drawn (utils/visitPayment, bonoForVisit,
-- owing) is untouched. No money rule moved into SQL. The ids travel in the
-- request body, so nothing is chunked any more.
--
-- One read is not a straight copy, and is the better for it. "Has this
-- patient another visit coming" was every future appointment of 150 patients
-- per request with no paging: past PostgREST's 1,000-row cap the tail was
-- silently dropped, and the patients in it were flagged "no next visit"
-- although they had one. Here it is at most two rows per patient -- all the
-- rule needs: more than one, or one that is not the visit being drawn -- so
-- no cap is in reach.

-- How a set of visits was paid for: the bono session each drew, with its
-- pack and that pack's other sessions, and the invoices with their payments
-- (oldest first) and each payment's factura. The shape
-- composables/useVisitPayments.ts used to ask PostgREST for in two selects.
create or replace function public.visit_payment_rows(p_appointment_ids uuid[])
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'package_sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_id', s.appointment_id,
        'amount_cents', s.amount_cents,
        'external_reference', s.external_reference,
        'used_at', s.used_at,
        'package_purchases', (
          select jsonb_build_object(
            'package_name', pp.package_name,
            'sessions_total', pp.sessions_total,
            'sessions_used', pp.sessions_used,
            'external_reference', pp.external_reference,
            'package_sessions', coalesce((
              select jsonb_agg(jsonb_build_object('used_at', s2.used_at))
              from package_sessions s2
              where s2.package_purchase_id = pp.id
            ), '[]'::jsonb)
          )
          from package_purchases pp
          where pp.id = s.package_purchase_id
        )
      ))
      from package_sessions s
      where s.appointment_id = any(p_appointment_ids)
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'appointment_id', i.appointment_id,
        'invoice_number', i.invoice_number,
        'total_cents', i.total_cents,
        'status', i.status,
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'method', p.method,
            'amount_cents', p.amount_cents,
            'paid_at', p.paid_at,
            -- One factura per payment (facturas_payment_id_uniq), so an
            -- object or null, as PostgREST embedded it.
            'facturas', (select jsonb_build_object('number', f.number) from facturas f where f.payment_id = p.id)
          ) order by p.paid_at)
          from payments p
          where p.invoice_id = i.id
        ), '[]'::jsonb)
      ))
      from invoices i
      where i.appointment_id = any(p_appointment_ids)
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.visit_payment_rows(uuid[]) from public, anon;
grant execute on function public.visit_payment_rows(uuid[]) to authenticated, service_role;

-- Everything a block draws beyond its own row, for the range in view.
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

-- What "Today at a glance" and the flow tracker need beside today's own
-- rows: the moves out of today, and what each patient waiting to pay owes.
--
-- The balances used to wait for today's rows, to know who was at checkout.
-- Here they are read for every visit today that has left the room and is not
-- finished -- the same visits, chosen by the columns the stage is read from;
-- the client still decides the stage (utils/appointmentStage) and ignores
-- any balance it has no checkout row for.
create or replace function public.calendar_today_details(
  p_clinic_id uuid,
  p_account_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'moves', coalesce((
      select jsonb_agg(jsonb_build_object('appointment_id', r.appointment_id, 'to_starts_at', r.to_starts_at))
      from appointment_reschedules r
      where r.account_id = p_account_id
        and r.from_starts_at >= p_from
        and r.from_starts_at < p_to
    ), '[]'::jsonb),
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object('patient_id', b.patient_id, 'outstanding_cents', b.outstanding_cents))
      from patient_live_balances b
      where b.patient_id in (
        select a.patient_id
        from appointments a
        where a.clinic_id = p_clinic_id
          and a.starts_at >= p_from
          and a.starts_at < p_to
          and a.deleted_at is null
          and a.flow_checkout_at is not null
          and a.status not in ('cancelled', 'completed', 'no_show')
      )
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_today_details(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_today_details(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- One visit's panel, for a screen that has no week loaded (the
-- practitioner's day): how it was paid, the patient's balance and packs, how
-- often it was moved, whether another visit is coming, the per-practitioner
-- overrides its price is read through, and its audit trail. It was a second
-- round of seven requests after the row itself, and one more for the trail;
-- it needs nothing from the row but its id, so it now travels beside it.
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
