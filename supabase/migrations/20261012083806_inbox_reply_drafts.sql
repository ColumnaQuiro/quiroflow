-- The receptionist's suggested reply in a patient's Inbox conversation,
-- written without anyone asking, so it is waiting there when somebody opens
-- the thread -- as lead drafts already were (leads.ai_draft_body).
--
-- Written only by the server (the receptionist-draft-cron, service role):
-- nobody inserts one or changes its words. Staff with Inbox access read it,
-- and mark it dealt with (dismissed_at) when they send it, take it into the
-- box or throw it away -- marked rather than deleted, because a deleted row
-- would read to the next tick as "never drafted", and the draft somebody just
-- threw away would be back fifteen minutes later.
--
-- One per conversation. drafted_through_at is the newest message from the
-- patient the draft answers: the tick writes a new one only when they have
-- said something since.
--
-- Keyed by conversation_key like the Inbox's other per-conversation tables
-- (notes, labels, archives) -- the patient's id for a patient's thread -- so
-- no patient_id column and nothing for merge_patients to move. A draft left
-- behind on a merged duplicate answers nobody, and is no loss.
--
-- No money in it: the draft is read by anyone with Inbox access, so the tick
-- writes it without the patient's balance (patientReplyDraft.ts), which the
-- button only includes for someone allowed to see it.

create table public.inbox_reply_drafts (
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_key text not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  drafted_through_at timestamptz not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (account_id, conversation_key)
);

alter table public.inbox_reply_drafts enable row level security;
create policy "inbox staff read inbox_reply_drafts" on public.inbox_reply_drafts
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));
create policy "inbox staff dismiss inbox_reply_drafts" on public.inbox_reply_drafts
  for update
  using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));
select public.require_two_factor_on('public.inbox_reply_drafts');

grant select on public.inbox_reply_drafts to authenticated;
-- The one thing staff change: that it has been dealt with. Not its words.
grant update (dismissed_at) on public.inbox_reply_drafts to authenticated;
