-- The accounts row holds most of the clinic's settings, and its update
-- policy ("staff can update their account", 0001) lets any member of the
-- account update any column. The Settings pages are gated by permission, but
-- the REST API is not: a receptionist could change the reschedule fees, the
-- receipt options, the booking page, the WhatsApp templates or the PracticeHub
-- connection with one PATCH. Found in the settings QA round, 30 Sep 2026.
--
-- A column-level GRANT cannot fix it for the same reason it could not for the
-- Stripe keys (20260913113238_account_secrets.sql): the table-level grant
-- covers every column. So this is a trigger. It looks only at the columns an
-- update actually CHANGES -- the pages save their whole form, unchanged
-- values included -- and requires, for each, the permission of the Settings
-- page that owns it (the same one components/settings/Nav.vue gates the page
-- on), plus settings_access.
--
-- A column not listed here needs an OWNER. That is deliberate: a new column
-- fails loudly for everyone else until it is given a permission here, rather
-- than quietly joining the "any member" set this closes.
--
-- Owners pass. The service role (no auth.uid()) passes: server routes check
-- permissions themselves before writing with it. The VeriFactu columns keep
-- their own guard (accounts_guard_verifactu), which also applies its
-- production lock to everyone.

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

create or replace function public.accounts_guard_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text;
  v_permission text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if exists (
    select 1 from public.team_members tm
    where tm.account_id = new.id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
  ) then
    return new;
  end if;

  for v_column in
    select n.key
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    v_permission := public.accounts_settings_permission(v_column);
    continue when v_permission = 'verifactu';
    if v_permission is null then
      raise exception 'Only an owner can change %', v_column using errcode = '42501';
    end if;
    if not (public.has_permission(new.id, 'settings_access') and public.has_permission(new.id, v_permission)) then
      raise exception 'Your role cannot change % (it needs %)', v_column, v_permission using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.accounts_guard_settings() from public, anon, authenticated;

drop trigger if exists accounts_guard_settings on public.accounts;
create trigger accounts_guard_settings
  before update on public.accounts
  for each row execute function public.accounts_guard_settings();

-- The PracticeHub API key moves to account_secrets, beside the Stripe keys:
-- it reads the clinic's whole PracticeHub history, and the accounts select
-- policy lets every member read every column. The importers now reach
-- PracticeHub through the proxy with the stored key, server-side
-- (server/api/import/practicehub-proxy.post.ts).
--
-- Copied, not moved, in this migration. It applies when the PR merges, but
-- the code live until the next release still reads the column -- the lead
-- drip among it (server/utils/leadSequences.ts asks PracticeHub whether a
-- lead has booked there). Emptied then, the drip would treat PracticeHub as
-- not configured and go on messaging people who had already booked. The
-- column is emptied by a follow-up migration once this code is released.
insert into public.account_secrets (account_id, name, value)
select id, 'practicehub_api_key', practicehub_api_key
from public.accounts
where practicehub_api_key is not null
on conflict (account_id, name) do update set value = excluded.value, updated_at = now();
