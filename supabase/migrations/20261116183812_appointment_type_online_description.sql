-- A description of each appointment type for the patient choosing one on the
-- booking page: what the visit involves, what to bring, who it is for.
-- PracticeHub has the same field ("description for online booking"), and
-- clinics coming from it missed it: a service list of bare names ("Primera
-- visita", "Revisión", "Ajuste") leaves a new patient guessing which to book.
--
-- Patient-facing on purpose, unlike appointment_type_staff_notes, which the
-- team reads and patients never do. So it lives on the type itself and goes
-- out through get_public_booking_info. Empty means no description, as before.
alter table appointment_types
  add column online_description text
    check (online_description is null or char_length(online_description) <= 1000);

comment on column appointment_types.online_description is 'Shown to patients under the type''s name on the booking page and in the patient app. Plain text, line breaks kept; null for none.';

-- The booking page reads it, so it is in each type it is given; the rest of
-- the function is unchanged from 20261101183809.
CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_account_name text;
  v_result jsonb;
begin
  select id, name into v_account_id, v_account_name from accounts where slug = p_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  select jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'id', a.id, 'name', a.name,
        'online_booking_max_days_ahead', a.online_booking_max_days_ahead,
        'online_booking_gtm_id', a.online_booking_gtm_id,
        'online_booking_referral_url', a.online_booking_referral_url,
        'online_booking_success_url', a.online_booking_success_url,
        'online_booking_primary_color', a.online_booking_primary_color,
        'online_booking_secondary_color', a.online_booking_secondary_color,
        'online_booking_background_color', a.online_booking_background_color,
        'online_booking_hide_logo', a.online_booking_hide_logo,
        'online_booking_hide_heading', a.online_booking_hide_heading,
        'online_booking_hide_language_picker', a.online_booking_hide_language_picker,
        'default_phone_country', a.default_phone_country,
        'online_booking_practitioner_order', a.online_booking_practitioner_order,
        'online_booking_text_overrides', a.online_booking_text_overrides,
        'appointment_confirmation_enabled', a.appointment_confirmation_enabled,
        'appointment_confirmation_channels', a.appointment_confirmation_channels,
        'discount_codes_enabled', exists (
          select 1 from online_booking_discount_codes d where d.account_id = a.id and d.active = true
        )
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'logo_storage_path', c.logo_storage_path, 'phone', c.phone, 'email', c.email,
        -- business_hours are wall-clock times in this zone. The page built
        -- slots in the VISITOR's zone, so a patient abroad was offered 09:00
        -- their time as if it were the clinic's.
        'timezone', c.timezone
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_payment_required', at.online_payment_required,
        'online_bookable_by', at.online_bookable_by,
        'online_bypass_practitioner', at.online_bypass_practitioner,
        'online_max_days_ahead', at.online_max_days_ahead,
        'online_deposit_cents', at.online_deposit_cents,
        'practitioner_ids', at.practitioner_ids,
        'online_description', nullif(btrim(at.online_description), '')
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color, 'business_hours', tm.business_hours,
        'photo_storage_path', tm.photo_storage_path,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true and tm.is_practitioner = true
        -- Not somebody who has left, whatever their switch says.
        and tm.deleted_at is null
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

-- And the patient app, which reads its types through its own function; the
-- rest unchanged from 20261106053857.
CREATE OR REPLACE FUNCTION public.get_patient_booking_info(p_patient_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
begin
  select r.account_id into v_account_id from public.acting_patient(p_patient_id) r;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  return jsonb_build_object(
    'settings', (
      select jsonb_build_object(
        'booking_enabled', a.patient_app_booking_enabled,
        'cancel_enabled', a.patient_app_cancel_enabled,
        'reschedule_enabled', a.patient_app_reschedule_enabled,
        'change_notice_hours', a.patient_app_change_notice_hours,
        'clinic_name', a.name,
        -- The clinic's default booking horizon, for a type that sets none.
        'max_days_ahead', a.online_booking_max_days_ahead,
        -- For the link to /book/<slug>, where a type needing payment can be
        -- booked and paid.
        'booking_slug', a.slug
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'timezone', c.timezone
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_max_days_ahead', at.online_max_days_ahead,
        -- The patient does not choose: booked with the first practitioner
        -- below who works at the chosen clinic.
        'online_bypass_practitioner', at.online_bypass_practitioner,
        'online_description', nullif(btrim(at.online_description), '')
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
        -- An app user always has a patient record: never a new patient.
        and at.online_bookable_by <> 'new_patients'
        and not public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'online_payment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name,
        'default_price_cents', at.default_price_cents,
        'online_deposit_cents', at.online_deposit_cents
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
        and at.online_bookable_by <> 'new_patients'
        and public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color,
        -- The practitioner's own week, which decides their slots on the web
        -- page (practitionerWindowsForDay). Without it the app offered the
        -- clinic's hours on a practitioner's days off.
        'business_hours', tm.business_hours,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        -- The web page's order, and patient_app_assigned_practitioner's.
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at, tm.id)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true
        and tm.is_practitioner = true and tm.deleted_at is null
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  );
end;
$function$;
