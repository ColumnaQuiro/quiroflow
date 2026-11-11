-- The clinic's own look inside the patient app: its logo, the name it goes
-- by, and one colour.
--
-- The app is still QuiroFlow in the stores and on the home screen -- the name
-- under the icon and the icon itself are part of the binary Apple and Google
-- approve, and only a separate app can change them. Everything a patient sees
-- once the app knows their clinic (from the join code on, so the sign-in
-- screen too) is drawn with these instead of QuiroFlow's indigo.
--
-- ONE colour, not a palette. Every colour in the app is a CSS variable
-- (assets/css/theme.css), and utils/clinicBrandPalette.ts derives the eight
-- brand variables for the light theme and the eight for the dark one from
-- this single value, darkening or lightening until text on it and text in it
-- pass contrast. A clinic choosing each shade by hand is how an app becomes
-- unreadable.
--
-- Sold as an add-on of its own. The clinic can fill these in and see the
-- preview whenever it likes; patients get the look only while the account has
-- the add-on (subscriptions.branding_addon), which is what
-- get_clinic_branding() decides. Its price and its row in `addons` are in
-- 20261111065621_branding_addon_price.sql; from then on the billing webhook
-- writes the column from the Stripe subscription, like the other add-ons.
--
-- The columns are named patient_app_% so accounts_settings_permission already
-- files them under clinic_config, the permission Settings > Brand is gated
-- on, with no change to that function. accounts is already audited.

alter table public.accounts
  add column patient_app_brand_name text,
  add column patient_app_brand_color text,
  add column patient_app_brand_logo_path text;

alter table public.accounts
  add constraint accounts_patient_app_brand_color_hex
    check (patient_app_brand_color is null or patient_app_brand_color ~ '^#[0-9a-f]{6}$'),
  add constraint accounts_patient_app_brand_name_length
    check (patient_app_brand_name is null or char_length(btrim(patient_app_brand_name)) between 1 and 40);

comment on column public.accounts.patient_app_brand_name is
  'The name patients see in the app instead of accounts.name. Null = accounts.name.';
comment on column public.accounts.patient_app_brand_color is
  'The clinic''s colour in the patient app, lower-case #rrggbb. The app derives every brand shade from it (utils/clinicBrandPalette.ts). Null = QuiroFlow''s.';
comment on column public.accounts.patient_app_brand_logo_path is
  'Path in the public clinic-logos bucket, under the account''s folder. Null = the first clinic''s logo, if any.';

alter table public.subscriptions add column branding_addon boolean not null default false;

comment on column public.subscriptions.branding_addon is
  'Whether this account has bought its own look in the patient app. Written by the platform billing webhook from the Stripe items; get_clinic_branding() reads it.';

-- What the app draws itself with, or null when this clinic's patients see
-- QuiroFlow's own look.
--
-- Callable signed out, by the join code: the sign-in screen is the first
-- thing a patient sees after typing it, and it should already be their
-- clinic's. That exposes nothing new -- the slug is the public booking URL,
-- and the name, colour and logo are what that page shows a stranger. Without
-- a code it answers for the signed-in patient's own clinic.
--
-- No mfa_satisfied() check for the same reason: nothing here is clinic data a
-- password alone should not reach, and patients have no second factor.
--
-- p_preview is for Settings > Brand, which shows a member what patients
-- would see before the add-on is bought: it skips the add-on test, and only
-- for a member of that account.
create or replace function public.get_clinic_branding(p_slug text default null, p_preview boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_active boolean;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_slug, '')), '') is not null then
    select id into v_account_id from accounts where slug = lower(btrim(p_slug));
  elsif auth.uid() is not null then
    select account_id into v_account_id
    from patients
    where user_id = auth.uid()
    order by created_at
    limit 1;
  end if;
  if v_account_id is null then
    return null;
  end if;

  -- The same reading as the other add-ons (server/utils/requireGrowth.ts):
  -- a comped account has everything, and a locked or cancelled one keeps
  -- nothing it had bought.
  select coalesce(s.comped, false) or (s.branding_addon and s.status not in ('locked', 'canceled'))
    into v_active
  from subscriptions s
  where s.account_id = v_account_id;

  if not coalesce(v_active, false) and not (coalesce(p_preview, false) and is_account_member(v_account_id)) then
    return null;
  end if;

  select jsonb_build_object(
    'name', coalesce(nullif(btrim(a.patient_app_brand_name), ''), a.name),
    'color', a.patient_app_brand_color,
    'logo_path', coalesce(
      a.patient_app_brand_logo_path,
      (select c.logo_storage_path from clinics c
        where c.account_id = a.id and c.archived_at is null and c.logo_storage_path is not null
        order by c.created_at
        limit 1)
    ),
    'active', coalesce(v_active, false)
  ) into v_result
  from accounts a
  where a.id = v_account_id;

  return v_result;
end;
$$;

revoke all on function public.get_clinic_branding(text, boolean) from public;
grant execute on function public.get_clinic_branding(text, boolean) to anon, authenticated;
