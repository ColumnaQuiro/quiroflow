-- Internal notes in an Inbox conversation: written by the team, for the
-- team, never sent to the patient. They sit in the thread between the
-- messages, on the web and in the app.
--
-- Shared, unlike read status and archive: anyone with Inbox access to the
-- account reads every note on a conversation. Only the author can delete
-- their own; nobody edits one (a note is said, like a message).
--
-- @mentions name colleagues (mentions, team_members ids). A mention marks the
-- conversation unread for that colleague -- the epoch in their inbox_reads,
-- the "marked unread" both Inboxes and the badge already understand -- so it
-- reaches them even with pushes off, and on app versions that do not draw
-- notes yet. Written by a trigger, since nobody may write another person's
-- read row. The push itself is sent by /api/inbox/note-mentions.
--
-- Keyed by conversation_key like the rest of the Inbox's per-conversation
-- tables (labels, archives, assignments), so no patient_id column and
-- nothing for merge_patients to move.

create table public.inbox_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_key text not null,
  author_id uuid references public.team_members(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index inbox_notes_conversation_idx on public.inbox_notes (account_id, conversation_key, created_at);

alter table public.inbox_notes enable row level security;
create policy "inbox staff read inbox_notes" on public.inbox_notes
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));
create policy "inbox staff write own inbox_notes" on public.inbox_notes
  for insert
  with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access') and author_id = current_team_member_id(account_id));
create policy "authors delete own inbox_notes" on public.inbox_notes
  for delete
  using (is_account_member(account_id) and author_id = current_team_member_id(account_id));
select public.require_two_factor_on('public.inbox_notes');

grant select, insert, delete on public.inbox_notes to authenticated;

-- A mention is unread for whoever it names (not the author), whatever they
-- had read before.
create or replace function public.inbox_note_mark_mentions_unread()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into inbox_reads (account_id, team_member_id, conversation_key, last_read_at)
  select new.account_id, tm.id, new.conversation_key, 'epoch'::timestamptz
  from team_members tm
  where tm.id = any(new.mentions)
    and tm.account_id = new.account_id
    and tm.deleted_at is null
    and tm.id is distinct from new.author_id
  on conflict (team_member_id, conversation_key) do update set last_read_at = 'epoch'::timestamptz;
  return new;
end;
$function$;
revoke all on function public.inbox_note_mark_mentions_unread() from public, anon, authenticated;

create trigger inbox_notes_mark_mentions_unread
  after insert on public.inbox_notes
  for each row execute function public.inbox_note_mark_mentions_unread();

-- A colleague's note shows up in an open thread without a reload.
alter publication supabase_realtime add table public.inbox_notes;
