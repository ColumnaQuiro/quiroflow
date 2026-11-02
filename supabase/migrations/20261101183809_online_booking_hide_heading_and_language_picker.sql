-- Two parts of the booking page's header a clinic can now leave out.
--
-- A clinic that embeds the page in its own site already has a "Book an
-- appointment" heading and its name above the iframe, so the page's own
-- heading and clinic name said both again, ~170 px further down before the
-- first practitioner. Columnaquiro's /reserva-cita/ was the first to ask.
--
-- The language picker (Español / English / Français) is the same story for a
-- site that is itself in more than one language: the patient already chose
-- one on the page around the iframe. Hidden, the language is ?lang= if the
-- link has one, then the embedding site's own (?site_lang=, which embed.js
-- reads from its <html lang>), then the browser's. Only hidden: a site that
-- still declares its theme's "en-US" over Spanish content would otherwise
-- turn the page English for a clinic that never chose anything.
--
-- Both default to shown, so no existing page changes. Covered by
-- accounts_guard_settings through the online_booking_ prefix.
alter table accounts
  add column online_booking_hide_heading boolean not null default false,
  add column online_booking_hide_language_picker boolean not null default false;

comment on column accounts.online_booking_hide_heading is 'Booking page: leave out the "Reservar una cita" heading and the clinic name under it (for a page embedded under the clinic''s own heading).';
comment on column accounts.online_booking_hide_language_picker is 'Booking page: leave out the Español/English/Français picker; the language then comes from ?lang=, the embedding site''s language (?site_lang=, from embed.js), or the browser.';

-- The booking page reads both, so they are in the account it is given; the
-- rest of the function is unchanged from 20261026141816.
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
