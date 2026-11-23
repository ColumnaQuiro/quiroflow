-- The activity timeline tells an imported note from a recall call.
--
-- The importers bring a clinic's history from its previous software into
-- contact_log as action 'other' with their own external_reference
-- (QuiroHiro "QH-ficha-"/"QH-note-", PracticeHub "PH-careplan-"/"PH-log-",
-- Quirocitas "QC-..."). patient_timeline returned those rows without the
-- reference, so utils/patientTimeline.ts could only show every one of them
-- as "Recall · Contacted": a full clinical record, filed as a phone call
-- nobody made. Returning external_reference lets it show them as notes,
-- saying where they came from.
--
-- The same function as 20261111192000_patient_overview_rpc.sql with one more
-- column on 'calls'. A client that does not read it is unaffected.

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
        select id, action, note, created_at, created_by, external_reference
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
