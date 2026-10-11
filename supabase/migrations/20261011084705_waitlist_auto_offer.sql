-- How a slot freed on the calendar reaches the waitlist.
--
-- waitlist_auto_offer: offer it without being asked. Off, a slot is offered
-- only when staff tick "offer it" while cancelling (and always when a
-- patient cancels from the portal or the app, as before). On, every way a
-- slot frees up offers it: a cancellation by staff, by the patient on
-- WhatsApp or through the public API, and a visit moved to another time.
--
-- waitlist_offer_mode: 'one_by_one' is what there was -- the oldest
-- matching entry gets it, with a deadline, then the next (an offer left
-- unanswered expires, as before). 'all_at_once' tells everyone who matches
-- together, and the first to accept books it: the claim already refuses a
-- slot that has been taken. The others go back to waiting -- when it is
-- taken, or when the deadline passes unclaimed -- rather than off the list:
-- not winning a race is not turning a slot down.
--
-- waitlist_entries.offered_to_all marks an offer made the second way, so the
-- expiry sweep returns it to waiting instead of expiring it and re-offering.
--
-- Both are Waitlist settings, so a change needs clinic_config, as the other
-- scheduling settings do (accounts_guard_settings).

alter table public.accounts
  add column waitlist_auto_offer boolean not null default false,
  add column waitlist_offer_mode text not null default 'one_by_one'
    check (waitlist_offer_mode in ('one_by_one', 'all_at_once'));

alter table public.waitlist_entries
  add column offered_to_all boolean not null default false;

-- Redefined from 20260930080701 with the waitlist columns added to
-- clinic_config; nothing else changes.
create or replace function public.accounts_settings_permission(p_column text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Settings > Online Booking, Mobile App, Scheduling Policies, New Patient Fields
    when p_column like 'online_booking\_%' or p_column like 'patient_app\_%'
      or p_column in ('cancellation_fee_cents', 'missed_appointment_fee_cents', 'scheduling_policy_fee_cents', 'new_patient_field_config')
      -- Waitlist > how freed slots are offered
      or p_column like 'waitlist\_%'
      then 'clinic_config'
    -- Settings > Invoicing, Payments
    when p_column like 'invoice\_email\_%' or p_column like 'hide\_%' or p_column like 'show\_%\_on_invoices' or p_column like 'stripe\_%' or p_column like 'factura\_%'
      or p_column in ('send_invoices_automatically_default', 'next_invoice_number', 'rectificativa_prefix')
      then 'billing_config'
    -- Settings > Messages, WhatsApp, Leads (and the Meta/Instagram connections)
    when p_column like 'appointment\_confirmation\_%' or p_column like 'appointment\_reminder\_%' or p_column like 'email\_%'
      or p_column like 'whatsapp\_%' or p_column like 'instagram\_%' or p_column like 'meta\_ads\_%' or p_column like 'lead\_%' or p_column like 'new_lead_notify\_%'
      or p_column in ('google_review_url', 'default_phone_country')
      then 'communication_config'
    -- Settings > Import (PracticeHub connection)
    when p_column like 'practicehub\_%' then 'data_admin'
    -- Settings > Team (require two-factor)
    when p_column = 'require_two_factor' then 'team_admin'
    -- Guarded by accounts_guard_verifactu, not here.
    when p_column like 'verifactu\_%' then 'verifactu'
    else null
  end
$$;
