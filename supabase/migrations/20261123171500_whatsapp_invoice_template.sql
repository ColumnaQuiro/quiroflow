-- The template a clinic sends a receipt or a factura with over WhatsApp
-- (Settings > WhatsApp > "Receipts and invoices"). WhatsApp lets a business
-- start a conversation only with a template Meta approved, so "Send by
-- WhatsApp" beside "Send by email" needs one chosen first: a template with a
-- DOCUMENT header, which the send fills with the same PDF the email attaches.
--
-- Stored like the other four (0016, 0103): a name, null until chosen, and a
-- language that defaults to Spanish.
alter table public.accounts
  add column if not exists whatsapp_invoice_template_name text,
  add column if not exists whatsapp_invoice_template_language text not null default 'es';

-- A new column on accounts needs a permission in accounts_guard_settings, or
-- only an owner can change it. These two are covered by the `whatsapp\_%`
-- branch of accounts_settings_permission
-- (20261121193000_settings_regroup_permissions.sql), which is the permission
-- Settings > WhatsApp is gated on. Checked here rather than assumed, so a
-- later restatement of that function that drops the branch fails this
-- migration on a fresh database instead of quietly making the setting
-- owner-only.
do $$
begin
  if public.accounts_settings_permission('whatsapp_invoice_template_name') is distinct from 'communication_config'
    or public.accounts_settings_permission('whatsapp_invoice_template_language') is distinct from 'communication_config' then
    raise exception 'whatsapp_invoice_template_* must be guarded by communication_config';
  end if;
end $$;
