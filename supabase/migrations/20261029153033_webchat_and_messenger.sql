-- Two more ways into the Inbox: a chat on the clinic's own website, and
-- Facebook Messenger on the Page the clinic already connected for Instagram.
--
-- Both are stored the way an Instagram DM is: a whatsapp_messages row on the
-- channel, a lead for the person writing, external_contact_id for who they
-- are when that is not a phone number. So the Inbox, the leads board and the
-- receptionist read them with nothing new to learn.

-- Settings > WhatsApp > Web chat. Off until the clinic turns it on: the
-- widget answers "not enabled" for every other account, however the snippet
-- got onto a page.
alter table public.accounts
  add column if not exists webchat_enabled boolean not null default false,
  add column if not exists webchat_greeting text,
  -- The Facebook Page whose Messenger conversations are this account's. Set
  -- when Instagram is connected: Instagram messaging goes through a Page, and
  -- connecting it already subscribed that Page to `messages`, which is what
  -- delivers its Messenger DMs too. They reached the webhook and were dropped,
  -- because the Page pass only read lead ads.
  add column if not exists messenger_page_id text;

-- One account per Page, for the reason accounts_instagram_user_id_key gives:
-- two accounts on one id is a DM nobody can route.
create unique index if not exists accounts_messenger_page_id_key
  on public.accounts (messenger_page_id)
  where messenger_page_id is not null;

alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_channel_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_channel_check
  check (channel in ('whatsapp', 'instagram', 'messenger', 'webchat'));

alter table public.leads drop constraint if exists leads_channel_check;
alter table public.leads add constraint leads_channel_check
  check (channel in ('whatsapp', 'sms', 'phone', 'web', 'instagram', 'facebook', 'walk_in', 'messenger', 'webchat'));

-- The new columns belong to Settings > WhatsApp, under communication_config
-- like Instagram's. Unlisted, they would need an owner.
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
      -- Online Booking > referral programme
      or p_column like 'referral\_%'
      then 'clinic_config'
    -- Settings > Invoicing, Payments
    when p_column like 'invoice\_email\_%' or p_column like 'hide\_%' or p_column like 'show\_%\_on_invoices' or p_column like 'stripe\_%' or p_column like 'factura\_%'
      or p_column in ('send_invoices_automatically_default', 'next_invoice_number', 'rectificativa_prefix')
      then 'billing_config'
    -- Settings > Messages, WhatsApp, Leads (and the Meta/Instagram connections)
    when p_column like 'appointment\_confirmation\_%' or p_column like 'appointment\_reminder\_%' or p_column like 'email\_%'
      or p_column like 'whatsapp\_%' or p_column like 'instagram\_%' or p_column like 'meta\_ads\_%' or p_column like 'lead\_%' or p_column like 'new_lead_notify\_%'
      or p_column in ('google_review_url', 'default_phone_country')
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
