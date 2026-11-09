-- One row per reply the AI receptionist writes, and what became of it.
--
-- Until now what happened inside a reply -- which tools it called and whether
-- they refused, whether a check sent the reply back to be rewritten or
-- withheld it, why it stayed a draft instead of going out -- was a console
-- line on Netlify, gone in a day and read by nobody. So a regression was
-- invisible until a patient noticed it, and "is it better since the change?"
-- had no answer. This is the answer: what it did, reply by reply, and what
-- each one cost.
--
-- It also records the replies held back because somebody from the clinic
-- was in the conversation (receptionistAutoReply.ts, 'person'), or changed
-- the patient's diary while the reply was being written ('diary'). Those
-- became drafts and the message counted as answered, so when the person
-- moved on without answering it nothing ever looked at it again: an MRI a
-- patient sent at 19:03 sat unanswered until they wrote again the next
-- morning (29 Oct 2026). `held_until` is when the hold ends; the 15-minute
-- handover job picks the reply up again from then (resumed_at).
--
-- What it holds is about the reply, not the person: the conversation key, the
-- names of the tools and the dates, times and types they were called with --
-- never names, phone numbers, emails or the text, which the conversation
-- itself already keeps. So nothing here needs moving by merge_patients or
-- removing by anonymize_patient, and conversation_key is text like
-- inbox_reply_drafts', not a foreign key.

create table public.receptionist_replies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- A patient's id, or lead:<id>: the Inbox's key for the conversation.
  conversation_key text not null,
  kind text not null check (kind in ('lead', 'patient')),
  -- Whether the clinic's switches let it send on its own at that moment.
  mode text not null check (mode in ('draft', 'send')),
  outcome text not null check (outcome in (
    'sent',            -- sent on its own
    'drafted',         -- left as a draft for a person, as asked
    'held_person',     -- would have sent; somebody from the clinic was in the conversation
    'held_diary',      -- would have sent; the team changed their visits meanwhile
    'held_limit',      -- would have sent; the day's limit in this conversation was reached
    'held_past_time',  -- offered a time today already gone; handed over
    'superseded',      -- they wrote again while it was being written; answered next tick
    'no_reply',        -- nothing needed saying
    'refused',         -- no reply could be given (the model declined, or a check withheld it)
    'send_failed',     -- written, and refused by the channel
    'voice_note',      -- a voice note: the fixed answer, and a person
    'minor'            -- a minor's record: a draft, and a person
  )),
  -- The newest message of theirs it answers.
  answers_through timestamptz,
  -- [{ name, ok, input }] in order, with input reduced to dates, times and types.
  tool_uses jsonb not null default '[]'::jsonb,
  -- The checks in code that fired: 'times_rewritten', 'claim_rewritten',
  -- 'claim_withheld', 'style_rewritten', 'briefing_withheld', 'model_refused'.
  checks text[] not null default '{}',
  handed_over boolean not null default false,
  model text,
  rounds smallint,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  duration_ms integer,
  held_until timestamptz,
  resumed_at timestamptz,
  -- What the handover job did once the hold ended: 'answered' (somebody had
  -- written), 'superseded' (they had), 'dismissed', 'person' (a person has
  -- the conversation), 'resent' (the receptionist answered it again), or
  -- 'handed_over' (it is not answering now: a person was told).
  resume_outcome text,
  created_at timestamptz not null default now()
);

create index receptionist_replies_account_created on public.receptionist_replies (account_id, created_at desc);
create index receptionist_replies_held on public.receptionist_replies (held_until) where held_until is not null and resumed_at is null;

alter table public.receptionist_replies enable row level security;
-- Read by whoever configures the receptionist; written only by the service
-- role, from the reply itself and the handover job.
create policy "receptionist config staff read receptionist_replies" on public.receptionist_replies
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.receptionist_replies');
select public.grant_data_api('public.receptionist_replies');
