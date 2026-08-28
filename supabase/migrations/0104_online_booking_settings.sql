-- Online booking parity fields (settings page: pages/settings/online-booking.vue).
-- Business hours + the per-clinic on/off toggle already live on `clinics`
-- (see 0034-era migrations); these are the account-wide widget-behavior
-- settings and the per-type booking rules that sit alongside the existing
-- appointment_types.online_booking_enabled/online_payment_required toggles.
alter table accounts
  add column online_booking_max_days_ahead int not null default 90,
  add column online_booking_gtm_id text,
  add column online_booking_referral_url text,
  add column online_booking_primary_color text,
  add column online_booking_secondary_color text,
  add column online_booking_hide_logo boolean not null default false,
  add column online_booking_practitioner_order text not null default 'default'
    check (online_booking_practitioner_order in ('default', 'alphabetical')),
  add column online_booking_text_overrides jsonb not null default '{}';

alter table appointment_types
  add column online_bookable_by text not null default 'all'
    check (online_bookable_by in ('all', 'new_patients', 'existing_patients')),
  add column online_bypass_practitioner boolean not null default false,
  add column online_max_days_ahead int,
  add column online_deposit_cents int;
