-- The calendar's reference data in one request.
--
-- Opening the calendar fired five requests before it could draw a column:
-- appointment types, practitioners, their per-type overrides, which clinic
-- each works at, and the clinic's rooms. On production's two-core database
-- requests fired together queue behind each other, so five small ones cost
-- more than five. One security-invoker function answers all of them from
-- the caller's own policies, exactly as the five selects did.
create or replace function public.calendar_reference(p_clinic_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'appointment_types', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id, name, duration_minutes, color, default_price_cents, sort_order, archived_at, class_capacity
        from appointment_types
      ) t
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, full_name, color, business_hours
        from team_members
        where deleted_at is null and is_practitioner
        order by full_name
      ) m
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(to_jsonb(o)) from (
        select appointment_type_id, team_member_id, duration_minutes, price_cents
        from appointment_type_overrides
      ) o
    ), '[]'::jsonb),
    'team_member_clinics', coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select team_member_id, clinic_id from team_member_clinics
      ) c
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select id, name from calendar_resources
        where p_clinic_id is not null and clinic_id = p_clinic_id
        order by name
      ) r
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_reference(uuid) from public, anon;
grant execute on function public.calendar_reference(uuid) to authenticated;
