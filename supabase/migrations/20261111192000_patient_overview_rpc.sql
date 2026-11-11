-- The patient record's Overview in two requests.
--
-- Opening a record on its Overview tab fired some three dozen requests: the
-- next and the last appointment, up to four more in sequence to say how the
-- last visit was paid, unpaid charges, forms not returned, the care plan and
-- three head-only counts for it, the plan's bono or membership, its visits
-- period by period, the bonos card (two), the family card (two), the care
-- stop (two or three), the team list -- and then the activity timeline's own
-- ten, one of which was the team list again. Each costs 50-100 ms of fixed
-- overhead on production's two-core database, and requests fired together
-- queue behind each other, so thirty small ones cost far more than thirty.
--
-- These two functions only fold the transport. Each key holds the rows the
-- client asked for before -- same columns, same filters, same order, same
-- limits, embeds as the nested objects PostgREST returned -- and the
-- TypeScript that turns them into what is on screen is unchanged
-- (components/patients/OverviewTab.vue, composables/usePatientTimeline.ts).
-- No money and no clinical rule is worked out here.
--
-- Security invoker, both: every table is read under the caller's own
-- policies, exactly as the separate selects were. A role without billing
-- access gets empty invoices and payments rather than an error, someone
-- without inbox access has no messages in their timeline, and the
-- restrictive two-factor policies apply as they do to any select.
--
-- p_now is the client's clock, as the page used it for "booked and still
-- ahead". Unlimited lists are no longer cut at PostgREST's max_rows (1000):
-- none of them comes near it for one patient.

create or replace function public.patient_overview(p_patient_id uuid, p_now timestamptz default now())
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with picked as (
    (select 'next'::text as slot_key, a.id, a.starts_at, a.ends_at, a.status, a.confirmation_status, a.clinic_id,
            a.practitioner_name, a.appointment_type_id, a.practitioner_id, a.room_id
     from appointments a
     where a.patient_id = p_patient_id and a.status = 'booked' and a.starts_at > p_now and a.deleted_at is null
     order by a.starts_at
     limit 1)
    union all
    (select 'last'::text, a.id, a.starts_at, a.ends_at, a.status, a.confirmation_status, a.clinic_id,
            a.practitioner_name, a.appointment_type_id, a.practitioner_id, a.room_id
     from appointments a
     where a.patient_id = p_patient_id and a.status = 'completed' and a.deleted_at is null
     order by a.starts_at desc
     limit 1)
  ),
  appt as materialized (
    select p.slot_key, p.id,
           jsonb_build_object(
             'id', p.id,
             'starts_at', p.starts_at,
             'ends_at', p.ends_at,
             'status', p.status,
             'confirmation_status', p.confirmation_status,
             'clinic_id', p.clinic_id,
             'practitioner_name', p.practitioner_name,
             'appointment_types', (select jsonb_build_object('name', t.name) from appointment_types t where t.id = p.appointment_type_id),
             'team_members', (select jsonb_build_object('full_name', m.full_name) from team_members m where m.id = p.practitioner_id),
             'calendar_resources', (select jsonb_build_object('name', r.name) from calendar_resources r where r.id = p.room_id)
           ) as doc
    from picked p
  ),
  -- How the last visit was paid: the session drawn for it, the charge raised
  -- for it, that charge's payments and their facturas. Four round trips, the
  -- last two waiting on the ones before.
  last_invoice as materialized (
    select i.id, i.invoice_number, i.total_cents, i.status
    from invoices i
    where i.appointment_id = (select id from appt where slot_key = 'last')
    limit 1
  ),
  last_payments as materialized (
    select p.id, p.method, p.amount_cents, p.paid_at
    from payments p
    where p.invoice_id = (select id from last_invoice)
  ),
  plan as materialized (
    select c.id, c.name, c.total_visits, c.frequency_value, c.frequency_unit, c.visits_per_period, c.started_at,
           c.payment_kind, c.package_purchase_id, c.patient_membership_id
    from care_plans c
    where c.patient_id = p_patient_id
    order by c.created_at desc
    limit 1
  ),
  -- The patient's visits, read once for the plan's three counts and its
  -- periods. Nothing is read for a patient with no plan.
  plan_appts as materialized (
    select a.starts_at, a.status
    from appointments a
    where a.patient_id = p_patient_id
      and a.deleted_at is null
      and exists (select 1 from plan)
  ),
  -- Since the plan started, or every one for a plan with no start date: the
  -- date compared as the page's filter compared it.
  plan_counted as (
    select v.starts_at, v.status
    from plan_appts v
    where (select started_at from plan) is null or v.starts_at >= (select started_at from plan)
  )
  select jsonb_build_object(
    'next_appointment', (select doc from appt where slot_key = 'next'),
    'last_visit', (select doc from appt where slot_key = 'last'),
    'last_visit_payment', jsonb_build_object(
      'session', (
        select jsonb_build_object(
          'amount_cents', s.amount_cents,
          'external_reference', s.external_reference,
          'package_purchases', (
            select jsonb_build_object(
              'package_name', pp.package_name,
              'sessions_total', pp.sessions_total,
              'sessions_used', pp.sessions_used,
              'external_reference', pp.external_reference)
            from package_purchases pp where pp.id = s.package_purchase_id))
        from package_sessions s
        where s.appointment_id = (select id from appt where slot_key = 'last')
        limit 1
      ),
      'invoice', (select to_jsonb(i) from last_invoice i),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount_cents', p.amount_cents) order by p.paid_at)
        from last_payments p
      ), '[]'::jsonb),
      'facturas', coalesce((
        select jsonb_agg(jsonb_build_object('number', f.number))
        from facturas f
        where f.payment_id in (select id from last_payments)
      ), '[]'::jsonb)
    ),
    'unpaid_invoices', coalesce((
      select jsonb_agg(to_jsonb(i)) from (
        select invoice_number, total_cents, created_at
        from invoices
        where patient_id = p_patient_id and status = 'unpaid'
        order by created_at
      ) i
    ), '[]'::jsonb),
    'awaiting_docs', coalesce((
      select jsonb_agg(to_jsonb(d)) from (
        select id, title, created_at
        from patient_docs
        where patient_id = p_patient_id and completed_at is null
        order by created_at
      ) d
    ), '[]'::jsonb),
    'plan', (select to_jsonb(p) from plan p),
    'plan_completed', (select count(*) from plan_counted where status = 'completed'),
    'plan_scheduled', (select count(*) from plan_counted where status = 'booked'),
    'plan_upcoming', (select count(*) from plan_counted where status = 'booked' and starts_at >= p_now),
    -- PlanPayment: the bono or the membership the plan is paid from.
    'plan_bono', (
      select jsonb_build_object(
        'package_name', pp.package_name,
        'sessions_total', pp.sessions_total,
        'sessions_used', pp.sessions_used,
        'is_closed', pp.is_closed)
      from plan p join package_purchases pp on pp.id = p.package_purchase_id
      where p.payment_kind = 'bono'
    ),
    'plan_membership', (
      select jsonb_build_object(
        'membership_name', pm.membership_name,
        'price_cents', pm.price_cents,
        'status', pm.status,
        'billing_interval', pm.billing_interval,
        'billing_interval_count', pm.billing_interval_count)
      from plan p join patient_memberships pm on pm.id = p.patient_membership_id
      where p.payment_kind = 'membership'
    ),
    -- PlanPeriods: every visit from the day the plan started (UTC midnight,
    -- as the component asked), whatever its status.
    'plan_visits', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', v.starts_at, 'status', v.status) order by v.starts_at)
      from plan_appts v
      where (select started_at from plan) is not null
        and v.starts_at >= ((select started_at from plan)::text || 'T00:00:00Z')::timestamptz
    ), '[]'::jsonb),
    'bonos_own', coalesce((
      select jsonb_agg(to_jsonb(b)) from (
        select id, package_name, sessions_total, sessions_used, is_closed
        from package_purchases
        where patient_id = p_patient_id and is_closed = false
        order by purchased_at desc
      ) b
    ), '[]'::jsonb),
    'bonos_shared', coalesce((
      select jsonb_agg(jsonb_build_object('package_purchases', (
        select jsonb_build_object(
          'id', pp.id,
          'package_name', pp.package_name,
          'sessions_total', pp.sessions_total,
          'sessions_used', pp.sessions_used,
          'is_closed', pp.is_closed,
          'patients', (select jsonb_build_object('first_name', o.first_name, 'last_name', o.last_name) from patients o where o.id = pp.patient_id))
        from package_purchases pp where pp.id = sh.package_purchase_id)))
      from package_purchase_shares sh
      where sh.patient_id = p_patient_id
    ), '[]'::jsonb),
    'family_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'related_patient_id', l.related_patient_id,
        'relation', l.relation,
        'related', (
          select jsonb_build_object(
            'id', o.id, 'first_name', o.first_name, 'last_name', o.last_name, 'gender', o.gender,
            'date_of_birth', o.date_of_birth, 'is_minor', o.is_minor, 'user_id', o.user_id)
          from patients o where o.id = l.related_patient_id)
      ) order by l.created_at)
      from patient_relations l
      where l.patient_id = p_patient_id
    ), '[]'::jsonb),
    'family_managers', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, manager_patient_id, patient_id, basis, access, note
        from patient_managers
        where patient_id = p_patient_id or manager_patient_id = p_patient_id
      ) m
    ), '[]'::jsonb),
    -- CareStopCard: the reason recorded since their last visit, if any, and
    -- the clinic's list of reasons to name it with.
    'care_stop', (select to_jsonb(s) from current_care_stops(array[p_patient_id]) s limit 1),
    'care_stop_reasons', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select id, name from care_stop_reasons order by sort_order, name
      ) r
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, full_name from team_members order by full_name
      ) m
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.patient_overview(uuid, timestamptz) from public, anon;
grant execute on function public.patient_overview(uuid, timestamptz) to authenticated, service_role;

-- The activity timeline's ten sources (utils/patientTimeline.ts merges and
-- sorts them): the newest p_limit of each, and the team's names for "who".
create or replace function public.patient_timeline(p_patient_id uuid, p_limit integer default 40)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'appointments', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select a.id, a.starts_at, a.created_at, a.status,
               (select jsonb_build_object('name', t.name) from appointment_types t where t.id = a.appointment_type_id) as appointment_types
        from appointments a
        where a.patient_id = p_patient_id and a.deleted_at is null
        order by a.created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, channel, kind, status, preview, sent_at
        from communications_log
        where patient_id = p_patient_id
        order by sent_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'whatsapp_inbound', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, channel, created_at, body_preview
        from whatsapp_messages
        where patient_id = p_patient_id and direction = 'inbound'
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'app_inbound', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, created_at, body
        from patient_app_messages
        where patient_id = p_patient_id and direction = 'inbound'
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, action, note, created_at, created_by
        from contact_log
        where patient_id = p_patient_id
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, name, created_at, created_by, frequency_value, frequency_unit, visits_per_period, total_visits
        from care_plans
        where patient_id = p_patient_id
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select pe.id, pe.created_at, pe.ended_at, pe.assigned_by,
               (select jsonb_build_object('name', e.name) from exercises e where e.id = pe.exercise_id) as exercises
        from patient_exercises pe
        where pe.patient_id = p_patient_id
        order by pe.created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, title, created_at, completed_at, created_by
        from patient_docs
        where patient_id = p_patient_id
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, created_at, invoice_number, status
        from invoices
        where patient_id = p_patient_id
        order by created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, full_name from team_members
      ) m
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.patient_timeline(uuid, integer) from public, anon;
grant execute on function public.patient_timeline(uuid, integer) to authenticated, service_role;
