-- The referral programme: each patient has a personal link to the clinic's
-- booking page (/book/<slug>?ref=<code>). Someone new who books through it is
-- recorded as referred by them -- the existing patients.referred_by_patient_id
-- (0095), which merge_patients already moves, and which fires the existing
-- patient.referred automations for the referrer -- and the clinic marks the
-- referrer rewarded once it has given whatever it promised.
--
--   patients.referral_code         the code in their link, made on first use
--                                  (my_referral_code), unique per clinic
--   patients.referral_rewarded_at  set on the REFERRED patient's row when the
--                                  clinic has rewarded whoever referred them
--   accounts.referral_program_enabled, accounts.referral_reward_text
--                                  on/off and what the patient is told they
--                                  get, in Settings > Online Booking
--
-- Additive only. No new patient_id column: referral_code is plain text, and
-- the duplicate's code simply goes with the duplicate on a merge (its
-- survivor keeps or gets one of its own).
alter table public.patients
  add column if not exists referral_code text,
  add column if not exists referral_rewarded_at timestamptz;
create unique index if not exists patients_referral_code_key on public.patients (account_id, referral_code) where referral_code is not null;

alter table public.accounts
  add column if not exists referral_program_enabled boolean not null default false,
  add column if not exists referral_reward_text text;

-- Redefined from 20261011084705 with the referral columns added to
-- clinic_config (Settings > Online Booking); nothing else changes.
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

-- A patient's own link: the clinic's booking slug and their code, made on
-- first use, or enabled = false when the clinic has not switched the
-- programme on. Only for the caller's own patient record.
create or replace function public.my_referral_code(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_code text;
  v_try int := 0;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  select a.* into v_account
  from public.patients p join public.accounts a on a.id = p.account_id
  where p.id = p_patient_id and p.user_id = auth.uid();
  if v_account.id is null then
    return null;
  end if;
  if not v_account.referral_program_enabled or v_account.slug is null then
    return jsonb_build_object('enabled', false);
  end if;
  select referral_code into v_code from public.patients where id = p_patient_id;
  while v_code is null and v_try < 8 loop
    v_try := v_try + 1;
    begin
      -- Six characters a person can read out: no 0/O or 1/I.
      v_code := translate(upper(substr(md5(gen_random_uuid()::text), 1, 6)), '01', '23');
      update public.patients set referral_code = v_code where id = p_patient_id and referral_code is null;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  return jsonb_build_object('enabled', true, 'slug', v_account.slug, 'code', v_code, 'reward', v_account.referral_reward_text);
end;
$$;
revoke all on function public.my_referral_code(uuid) from public, anon;
grant execute on function public.my_referral_code(uuid) to authenticated;
