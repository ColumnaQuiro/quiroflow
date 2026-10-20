-- Whether a patient has the app, and when they last opened it, on their
-- record.
--
-- app_opens (0087) already gets a row per device on every launch of the
-- mobile app, but it only knew the clinic, so the most it could say was how
-- many devices a clinic had -- Settings > App's counts. The front desk asks a
-- narrower question at the desk: does THIS patient have it, or should I send
-- them the link?
--
-- record_app_open() is already called with the patient's session when one
-- exists (mobile/app.vue pings on every launch, after supabase-js has
-- restored the stored session), so it can record auth.uid() itself: no new
-- argument, and therefore no app release needed for this to start filling.
-- A launch with nobody signed in keeps the user the device last had rather
-- than forgetting it.
--
-- Devices that opened the app before this ran have no user until their
-- next launch, which is why the record says "has an account" rather than
-- "never opened the app" when a patient has a login and no device yet.

alter table app_opens add column user_id uuid references auth.users(id) on delete set null;

create index app_opens_user_idx on app_opens (user_id) where user_id is not null;

create or replace function record_app_open(p_account_slug text, p_device_id uuid, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'Invalid platform';
  end if;

  select id into v_account_id from accounts where slug = lower(trim(p_account_slug));
  if v_account_id is null then
    raise exception 'Unknown clinic';
  end if;

  insert into app_opens (device_id, account_id, platform, first_seen_at, last_seen_at, user_id)
  values (p_device_id, v_account_id, p_platform, now(), now(), auth.uid())
  on conflict (device_id) do update
    set last_seen_at = now(),
        account_id = excluded.account_id,
        platform = excluded.platform,
        user_id = coalesce(excluded.user_id, app_opens.user_id);
end;
$$;
