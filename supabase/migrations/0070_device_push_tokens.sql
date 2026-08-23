-- Push-notification device registration for the mobile app. Any signed-in
-- user (patient or team_member) can register a device; v1 only actually
-- sends pushes for practitioners (new WhatsApp messages), but the table
-- isn't role-scoped so patient push can be added later without a schema
-- change.
create table device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  fcm_token text not null,
  created_at timestamptz not null default now(),
  unique (user_id, fcm_token)
);

alter table device_push_tokens enable row level security;

create policy "users manage own device_push_tokens" on device_push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
