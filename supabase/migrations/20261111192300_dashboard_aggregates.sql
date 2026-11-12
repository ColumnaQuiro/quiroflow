-- The dashboard's figures, the setup checklist and two reports, without
-- downloading the tables behind them.
--
-- Several dashboard widgets read whole tables to show one number: every
-- completed appointment of the last 90 days to count the patients in them,
-- every row of recall_candidates for a count and an average, every completed
-- appointment there has ever been for "visits in the period". PostgREST hands
-- back 1,000 rows a request, so each of those grew by a request, and by a
-- page of rows to parse, for every thousand visits a clinic books. The owner's
-- dashboard also asked nine questions about setup on every visit, one of them
-- an exact count of all appointments, and the Statistics and Retention
-- reports paged their sources in up to twenty requests.
--
-- On production's two-core database requests fired together queue behind
-- each other, and each costs 50-100 ms before it reads a row. So:
--
--   * counts and existence checks are answered in SQL, with the filters the
--     browser applied;
--   * anything about money (what a bono is still owed) and the reports'
--     arithmetic stay in TypeScript, and only the TRANSPORT is folded: one
--     function returns the same rows the paged selects did, as one object.
--
-- Every function here is security INVOKER, so each read goes through the
-- caller's own policies exactly as the selects it replaces did. A role that
-- may not read a table still gets nothing from it, not an error.

-- Patients with a completed visit since p_since: the "Active patients" tile.
-- No deleted_at filter, because the select this replaces had none.
create or replace function public.dashboard_active_patients(p_since timestamptz, p_practitioner_id uuid default null)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select count(distinct a.patient_id)::integer
  from appointments a
  where a.status = 'completed'
    and a.starts_at >= p_since
    and (p_practitioner_id is null or a.practitioner_id = p_practitioner_id);
$function$;

revoke all on function public.dashboard_active_patients(timestamptz, uuid) from public, anon;
grant execute on function public.dashboard_active_patients(timestamptz, uuid) to authenticated, service_role;

-- How many patients are due a recall and the days they add up to, counted
-- THROUGH recall_candidates so the rule stays in the view. The average is
-- left to the caller (sum / count), which rounds it as it always has.
create or replace function public.dashboard_recalls_due(p_min_days integer, p_practitioner_id uuid default null)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'count', count(*),
    'days_total', coalesce(sum(rc.days_since_last_appointment), 0)
  )
  from recall_candidates rc
  where rc.days_since_last_appointment >= p_min_days
    and (p_practitioner_id is null or rc.default_practitioner_id = p_practitioner_id);
$function$;

revoke all on function public.dashboard_recalls_due(integer, uuid) from public, anon;
grant execute on function public.dashboard_recalls_due(integer, uuid) to authenticated, service_role;

-- "Visit value & retention": completed visits in the period, the patients in
-- them, and how many of those had a completed visit before it. The widget
-- used to read every completed appointment ever to work these three out.
-- Both ends of the period are inclusive, as they were in the browser.
create or replace function public.dashboard_visit_stats(
  p_from timestamptz,
  p_to timestamptz,
  p_practitioner_id uuid default null,
  p_clinic_id uuid default null
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with in_range as (
    select a.patient_id
    from appointments a
    where a.status = 'completed'
      and a.starts_at >= p_from and a.starts_at <= p_to
      and (p_practitioner_id is null or a.practitioner_id = p_practitioner_id)
      and (p_clinic_id is null or a.clinic_id = p_clinic_id)
  ),
  seen as (select distinct patient_id from in_range)
  select jsonb_build_object(
    'visits', (select count(*) from in_range),
    'patients', (select count(*) from seen),
    'returning', (
      select count(*) from seen s
      where exists (
        select 1 from appointments b
        where b.patient_id = s.patient_id
          and b.status = 'completed'
          and b.starts_at < p_from
          and (p_practitioner_id is null or b.practitioner_id = p_practitioner_id)
          and (p_clinic_id is null or b.clinic_id = p_clinic_id)
      )
    )
  );
$function$;

revoke all on function public.dashboard_visit_stats(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.dashboard_visit_stats(timestamptz, timestamptz, uuid, uuid) to authenticated, service_role;

-- What a clinic has set up, for /setup and the two cards on the owner's
-- dashboard. `exists` wherever the browser asked for an exact count only to
-- compare it with zero; the one count kept is the one shown as a number.
-- p_account_id narrows the same reads the browser narrowed by account
-- (the account row, team members, imported patients, automations); the rest
-- had no filter but the caller's policies, and have none here.
--
-- "Filled in" means what String.trim() left non-empty in the browser, so the
-- characters trimmed are JavaScript's white space, not only the space btrim
-- removes by default.
create or replace function public.setup_checklist(p_account_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with ws as (
    select U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' as chars
  ),
  acct as (
    select whatsapp_phone_number_id, whatsapp_reminder_template_name, appointment_reminder_enabled, verifactu_mode
    from accounts where id = p_account_id
  ),
  open_clinics as (
    select btrim(coalesce(c.address, ''), ws.chars) <> '' as has_address,
           btrim(coalesce(c.phone, ''), ws.chars) <> '' as has_phone,
           btrim(coalesce(c.tax_id, ''), ws.chars) <> '' as has_tax_id,
           btrim(coalesce(c.legal_name, ''), ws.chars) <> '' as has_legal_name,
           coalesce(c.online_booking_enabled, false) as online_booking
    from clinics c, ws
    where c.archived_at is null
  )
  select jsonb_build_object(
    'clinic_details', exists (select 1 from open_clinics) and not exists (select 1 from open_clinics where not (has_address and has_phone)),
    'fiscal', exists (select 1 from open_clinics) and not exists (select 1 from open_clinics where not (has_tax_id and has_legal_name)),
    'online_booking', exists (select 1 from open_clinics where online_booking),
    'services', exists (select 1 from appointment_types where archived_at is null),
    'team', (select count(*) from team_members where account_id = p_account_id and deleted_at is null) > 1
            or exists (select 1 from account_invites where accepted_at is null),
    -- What an importer wrote carries its source's reference; a patient typed
    -- in by hand does not.
    'imported', exists (select 1 from patients where account_id = p_account_id and external_reference is not null),
    'whatsapp', coalesce((select coalesce(whatsapp_phone_number_id, '') <> '' from acct), false),
    -- The built-in reminder, or an automation doing the same job.
    'reminders', coalesce((select coalesce(appointment_reminder_enabled, false) and coalesce(whatsapp_reminder_template_name, '') <> '' from acct), false)
                 or exists (
                   select 1 from automation_rules
                   where account_id = p_account_id and trigger_event = 'appointment.hours_before' and enabled
                 ),
    'verifactu', coalesce((select coalesce(verifactu_mode, '') not in ('', 'off') from acct), false),
    'first_visit', exists (select 1 from appointments),
    -- The dashboard's first steps: the newest patient (the one "book a first
    -- visit" opens the calendar with) and the visits still under a name from
    -- the old software, the rows Settings -> Team lists as not linked.
    'latest_patient_id', (select id from patients order by created_at desc limit 1),
    'unlinked_visits', (
      select count(*) from appointments
      where practitioner_id is null and practitioner_name is not null and deleted_at is null
    )
  );
$function$;

revoke all on function public.setup_checklist(uuid) from public, anon;
grant execute on function public.setup_checklist(uuid) to authenticated, service_role;

-- Everything the Debtors report and the dashboard's Debtors widget need to
-- work out what each bono is still owed -- the rows, not the answer. The
-- rule (utils/bonoOwed.ts) stays in TypeScript, where the patient's Billing
-- tab uses the same function; this only replaces the paged selects that
-- fetched its inputs, in the shape they returned them:
--
--   purchases        each with its patient's name and its sale invoice, the
--                    invoice carrying the payments made on it;
--   linked_payments  payments pointing at a purchase directly;
--   schedules        Stripe schedules on a purchase. These were read without
--                    paging, so past 1,000 of them a bono being collected by
--                    Stripe read as a plain debt. All of them now.
create or replace function public.bono_debts(p_newest_first boolean default false)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'purchases', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select pp.id, pp.patient_id, pp.package_name, pp.sessions_total, pp.sessions_used, pp.price_cents,
               pp.purchased_at, pp.invoice_id, pp.owed_cents, pp.installments, pp.installment_cents, pp.external_reference,
               (
                 select jsonb_build_object('first_name', pt.first_name, 'last_name', pt.last_name)
                 from patients pt where pt.id = pp.patient_id
               ) as patients,
               (
                 select jsonb_build_object(
                   'id', i.id, 'status', i.status, 'total_cents', i.total_cents,
                   'payments', coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'invoice_id', p.invoice_id, 'amount_cents', p.amount_cents,
                       'package_purchase_id', p.package_purchase_id, 'external_reference', p.external_reference, 'purpose', p.purpose
                     ))
                     from payments p where p.invoice_id = i.id
                   ), '[]'::jsonb)
                 )
                 from invoices i where i.id = pp.invoice_id
               ) as invoices
        from package_purchases pp
        -- Newest first for the report; by id for the widget, which sorts its own.
        order by case when p_newest_first then pp.purchased_at end desc, pp.id
      ) x
    ), '[]'::jsonb),
    'linked_payments', coalesce((
      select jsonb_agg(to_jsonb(p)) from (
        select id, invoice_id, amount_cents, package_purchase_id, external_reference, purpose
        from payments
        where package_purchase_id is not null
        order by id
      ) p
    ), '[]'::jsonb),
    'schedules', coalesce((
      select jsonb_agg(to_jsonb(s)) from (
        select package_purchase_id, status
        from payment_schedules
        where package_purchase_id is not null
        order by created_at, id
      ) s
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.bono_debts(boolean) from public, anon;
grant execute on function public.bono_debts(boolean) to authenticated, service_role;

-- Reports -> Statistics: every appointment not deleted, whatever its status,
-- and the appointment types. The funnel there needs each patient's whole
-- history, so the rows still all travel -- but in one response rather than
-- a count and a page per thousand, and without the id nothing read. Ordered
-- by id, as the pages were: the report sorts by time and that order breaks
-- its ties.
create or replace function public.report_statistics_rows()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'appointments', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select patient_id, starts_at, status, appointment_type_id, practitioner_id, clinic_id
        from appointments
        where deleted_at is null
        order by id
      ) a
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id, name, stage from appointment_types
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.report_statistics_rows() from public, anon;
grant execute on function public.report_statistics_rows() to authenticated, service_role;

-- Reports -> Retention: its four sources in one response. The contact log
-- alone was some twenty pages, fetched one after another, for the largest
-- clinic. The arithmetic stays in utils/retentionStats.ts.
--
-- plpgsql rather than sql for one reason: the page treated three of the four
-- reads as optional -- a failed read of the plans or the care stops showed
-- none, and a failed read of the contact log hid Win-back -- and only the
-- visits were allowed to fail the report. Each optional read keeps that here
-- by answering null on its own, where a single statement would have taken
-- the visits down with it.
create or replace function public.report_retention_rows(p_clinic_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_visits jsonb;
  v_plans jsonb;
  v_contacts jsonb;
  v_stops jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_visits from (
    select patient_id, practitioner_id, starts_at, ends_at, status, created_at
    from appointments
    where deleted_at is null and patient_id is not null
      and (p_clinic_id is null or clinic_id = p_clinic_id)
    order by starts_at, id
  ) v;

  begin
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_plans from (
      select patient_id, default_practitioner_id, first_name, last_name, care_plan_name, total_visits,
             completed_in_plan, last_appointment_at, days_overdue
      from care_plan_continuity_alerts
      where days_overdue > 0
      order by days_overdue desc
      limit 200
    ) a;
  exception when others then
    v_plans := null;
  end;

  -- Reaching out, not appointment reminders: those carry the appointment.
  begin
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_contacts from (
      select patient_id, created_at
      from contact_log
      where appointment_id is null
      order by created_at
    ) c;
  exception when others then
    v_contacts := null;
  end;

  begin
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_stops from (
      select reason_id, practitioner_id, clinic_id, recorded_at
      from patient_care_stops
      order by recorded_at
    ) s;
  exception when others then
    v_stops := null;
  end;

  return jsonb_build_object('visits', v_visits, 'plans', v_plans, 'contacts', v_contacts, 'stops', v_stops);
end;
$function$;

revoke all on function public.report_retention_rows(uuid) from public, anon;
grant execute on function public.report_retention_rows(uuid) to authenticated, service_role;
