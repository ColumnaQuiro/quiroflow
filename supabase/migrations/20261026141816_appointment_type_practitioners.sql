-- Who does an appointment type: some practitioners only, or everyone.
--
-- Columnaquiro's children's first visit is Jordana's -- Natacha does not see
-- children -- and nothing could say so: the AI receptionist books the first
-- practitioner free at the time accepted, and a new child inherited the
-- practitioner of the parent writing. A knowledge card asked it to keep to
-- Jordana, which it could not, since it never chooses who.
--
-- Empty means everyone, as before: every existing type keeps working.
-- Respected wherever times are offered to patients -- the AI receptionist's
-- lists and bookings, the booking page and the public API's availability.
-- Staff booking from the calendar is not restricted: they know who does what.
alter table appointment_types add column practitioner_ids uuid[] not null default '{}';

comment on column appointment_types.practitioner_ids is 'The practitioners who do this type; empty for everyone. Patients are offered times only with them (AI receptionist, booking page, public API).';

-- The booking page reads it, so it is in the types the page is given; the
-- rest of the function is unchanged.
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
        'practitioner_ids', at.practitioner_ids
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
