-- What each member of the team wants their phone to tell them (the app's
-- Profile > Avisos). One row per person, written by that person only; the
-- server reads them with the service role when it decides who to push to
-- (server/utils/staffPush.ts).
--
-- No row means the defaults below, which are what the app did before this
-- table existed for the one push it sent (Inbox messages, at any hour) plus
-- the new ones a practitioner most likely wants. Check-ins start off: at a
-- busy desk they are constant, and the practitioner usually sees the patient
-- walk in.
--
-- summary_sent_on is the 8:00 summary's claim for the day: the same-day cron
-- runs every 15 minutes, and two ticks inside the window must not send it
-- twice.
create table public.staff_push_preferences (
  team_member_id uuid primary key references team_members(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  online_bookings boolean not null default true,
  changes boolean not null default true,
  inbox boolean not null default true,
  check_in boolean not null default false,
  morning_summary boolean not null default true,
  quiet_hours boolean not null default false,
  summary_sent_on date,
  updated_at timestamptz not null default now()
);
create index staff_push_preferences_account_idx on public.staff_push_preferences (account_id);

alter table public.staff_push_preferences enable row level security;
create policy "staff manage own push preferences" on public.staff_push_preferences
  for all using (
    is_account_member(account_id)
    and team_member_id = current_team_member_id(account_id)
  )
  with check (
    is_account_member(account_id)
    and team_member_id = current_team_member_id(account_id)
  );
select public.require_two_factor_on('public.staff_push_preferences');
