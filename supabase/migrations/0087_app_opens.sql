-- Real "how many devices have the app installed" tracking for the mobile
-- app, requested for a new Settings > App page. device_push_tokens alone
-- undercounts (only devices that granted notification permission), so this
-- is a dedicated device ping instead: one row per device, upserted on
-- every launch. Only ever written once a clinic slug is known (see
-- mobile/pages/join.vue, mobile/app.vue), so account_id is not null.

create table app_opens (
  device_id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index app_opens_account_idx on app_opens (account_id);

alter table app_opens enable row level security;

create policy "staff read app_opens" on app_opens
  for select using (is_account_member(account_id));

-- No direct-table write path -- the device pinging in has no team_member
-- session (often no session at all pre-signup), so writes go through this
-- security definer RPC keyed by the public account slug instead, same
-- shape as claim_patient_profile's slug lookup.
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

  insert into app_opens (device_id, account_id, platform, first_seen_at, last_seen_at)
  values (p_device_id, v_account_id, p_platform, now(), now())
  on conflict (device_id) do update
    set last_seen_at = now(), account_id = excluded.account_id, platform = excluded.platform;
end;
$$;

revoke execute on function record_app_open(text, uuid, text) from public;
grant execute on function record_app_open(text, uuid, text) to anon, authenticated;
