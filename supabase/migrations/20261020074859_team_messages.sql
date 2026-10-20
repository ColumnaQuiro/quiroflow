-- Messages between the people who work at a clinic: a practitioner asking
-- the desk to bring the next patient, the desk telling a practitioner their
-- 11:00 is running late. Clinics moving from other software asked for it
-- more than once (PracticeHub's community, two threads); what they used
-- instead -- Slack, WhatsApp groups, Teams -- is one more app open beside the
-- calendar, and not the one already on every screen in the clinic.
--
-- Two kinds of thread: the whole team (recipient_id null) and one person to
-- another (recipient_id set). A row is visible to its sender, its recipient,
-- or -- for a whole-team message -- everyone in the account. Nobody edits or
-- deletes one: a message is said.
--
-- kind 'alert' is the "I need help in here" button: a staff member who feels
-- unsafe with a patient, or needs a hand now. It goes to the whole team,
-- stays on every open screen until someone answers it (acknowledged_by),
-- and its push ignores quiet hours.
--
-- No patient_id: staff may name a patient in a message, but the table is
-- not keyed to one, so merge_patients and anonymize_patient have nothing to
-- move. Not audited: append-only already, and audit_logs would only copy
-- what is here.

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  sender_id uuid not null references public.team_members(id) on delete cascade,
  -- Null: the whole team.
  recipient_id uuid references public.team_members(id) on delete cascade,
  kind text not null default 'message' check (kind in ('message', 'alert')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  -- Where an alert was raised, so whoever answers knows where to go.
  clinic_id uuid references public.clinics(id) on delete set null,
  room_id uuid references public.calendar_resources(id) on delete set null,
  acknowledged_by uuid references public.team_members(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_messages_alert_is_for_everyone check (kind = 'message' or recipient_id is null),
  constraint team_messages_not_to_self check (recipient_id is distinct from sender_id)
);
create index team_messages_account_idx on public.team_messages (account_id, created_at desc);
create index team_messages_alert_idx on public.team_messages (account_id, created_at desc) where kind = 'alert' and acknowledged_at is null;

alter table public.team_messages enable row level security;
create policy "team reads its messages" on public.team_messages
  for select
  using (
    is_account_member(account_id)
    and (recipient_id is null or recipient_id = current_team_member_id(account_id) or sender_id = current_team_member_id(account_id))
  );
create policy "team sends as itself" on public.team_messages
  for insert
  with check (
    is_account_member(account_id)
    and sender_id = current_team_member_id(account_id)
    and acknowledged_by is null
    and acknowledged_at is null
    and (recipient_id is null or exists (select 1 from team_members tm where tm.id = recipient_id and tm.account_id = team_messages.account_id and tm.deleted_at is null))
  );
select public.require_two_factor_on('public.team_messages');

grant select, insert on public.team_messages to authenticated;

-- Where each person has read up to, per thread: 'team' for the whole-team
-- thread, a colleague's team_members id for the one with them. Each
-- person's own, like inbox_reads.
create table public.team_message_reads (
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  thread_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (team_member_id, thread_key)
);

alter table public.team_message_reads enable row level security;
create policy "own team_message_reads" on public.team_message_reads
  for all
  using (is_account_member(account_id) and team_member_id = current_team_member_id(account_id))
  with check (is_account_member(account_id) and team_member_id = current_team_member_id(account_id));
select public.require_two_factor_on('public.team_message_reads');

grant select, insert, update on public.team_message_reads to authenticated;

-- Answering an alert: "on my way". Anyone in the account may, once, and only
-- the acknowledgement columns change -- which is why it is a function rather
-- than an update policy, which could not stop the body being rewritten.
create or replace function public.acknowledge_team_alert(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account uuid;
  v_me uuid;
begin
  select account_id into v_account from team_messages where id = p_message_id and kind = 'alert';
  if v_account is null or not is_account_member(v_account) then
    raise exception 'Alert not found';
  end if;
  if not mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  v_me := current_team_member_id(v_account);
  update team_messages
     set acknowledged_by = v_me, acknowledged_at = now()
   where id = p_message_id and acknowledged_at is null;
end;
$$;
revoke all on function public.acknowledge_team_alert(uuid) from public, anon;
grant execute on function public.acknowledge_team_alert(uuid) to authenticated;

-- A message, and an alert's acknowledgement, reach open screens at once.
alter publication supabase_realtime add table public.team_messages;
