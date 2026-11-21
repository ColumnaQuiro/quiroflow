-- Settings regrouped: two settings move page, so their permission moves too.
--
-- accounts_guard_settings requires, for every column an update changes, the
-- permission of the Settings page that owns it (accounts_settings_permission).
-- A column whose page changes has to change permission with it, or the new
-- page saves for owners and fails for everyone else.
--
--  * default_phone_country moved from Settings > Messages to Settings > New
--    Patient Fields, beside the phone field it fills in. communication_config
--    -> clinic_config, the permission that page and new_patient_field_config
--    are already under.
--
--  * online_booking_notify_* (email, WhatsApp and its template) moved from
--    Settings > Online Booking to Settings > Team alerts, beside the new-lead
--    alert. clinic_config -> communication_config, like new_lead_notify_*.
--    This also fixes Settings > WhatsApp, which saves
--    online_booking_notify_whatsapp_template_* and is a communication_config
--    page: someone with that permission and not clinic_config could not save
--    the WhatsApp templates at all. The clause has to come before the
--    online_booking_% one, which would otherwise match first.
--
-- google_review_url moved from Settings > Messages to Settings > Reviews and
-- stays communication_config, so it is unchanged here.
--
-- Restated in full from 20261112060227_gocardless_direct_debit.sql. The next
-- migration that restates this function must start from this file.
create or replace function public.accounts_settings_permission(p_column text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Settings > Team alerts: who is told about a new online booking
    when p_column like 'online_booking\_notify\_%' then 'communication_config'
    -- Settings > Online Booking, Mobile App, Changes & cancellations, New Patient Fields
    when p_column like 'online_booking\_%' or p_column like 'patient_app\_%'
      or p_column in ('cancellation_fee_cents', 'missed_appointment_fee_cents', 'scheduling_policy_fee_cents', 'new_patient_field_config', 'default_phone_country')
      -- Waitlist > how freed slots are offered
      or p_column like 'waitlist\_%'
      -- Online Booking > referral programme
      or p_column like 'referral\_%'
      -- Settings > Care plans: maintenance, discharge and the habits pack
      or p_column like 'maintenance\_%'
      then 'clinic_config'
    -- Settings > Invoicing, Payments
    when p_column like 'invoice\_email\_%' or p_column like 'hide\_%' or p_column like 'show\_%\_on_invoices' or p_column like 'stripe\_%' or p_column like 'gocardless\_%' or p_column like 'factura\_%'
      or p_column in ('send_invoices_automatically_default', 'next_invoice_number', 'rectificativa_prefix')
      then 'billing_config'
    -- Settings > Messages, WhatsApp, Team alerts, Leads, Reviews (and the Meta/Instagram connections)
    when p_column like 'appointment\_confirmation\_%' or p_column like 'appointment\_reminder\_%' or p_column like 'email\_%'
      or p_column like 'whatsapp\_%' or p_column like 'instagram\_%' or p_column like 'meta\_ads\_%' or p_column like 'lead\_%' or p_column like 'new_lead_notify\_%'
      or p_column = 'google_review_url'
      -- Settings > WhatsApp > Web chat, and the Messenger Page beside Instagram
      or p_column like 'webchat\_%' or p_column like 'messenger\_%'
      -- Settings > Recalls: who a new recall is assigned to
      or p_column like 'recall\_assignee\_%'
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
