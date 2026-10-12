-- The receptionist answering on its own (Growth > Receptionist: "answer
-- outside clinic hours" / "answer during clinic hours"), rather than only
-- leaving drafts.
--
-- sent_by_ai: which outbound messages the receptionist sent, as opposed to a
-- person. The tick reads it to stay quiet while somebody from the clinic is
-- in the conversation (a person replied within the last hour) and to cap how
-- many it sends in one conversation a day; the daily review reads it to tell
-- the two apart. Default false: every message so far was a person's.
--
-- inbox_reply_drafts.handed_over_at: the receptionist passed this patient's
-- conversation to a person (an escalation rule, or something it could not
-- do). From then it only drafts there until someone from the clinic writes
-- in the conversation again. A lead's equivalent is ai_state 'needs_human'.
-- Written only by the server; the column grant for staff stays dismissed_at.

alter table public.whatsapp_messages add column sent_by_ai boolean not null default false;
alter table public.patient_app_messages add column sent_by_ai boolean not null default false;

alter table public.inbox_reply_drafts add column handed_over_at timestamptz;

-- Answering on its own is something a clinic turns on, never something it
-- finds already on. after_hours was created defaulting to true and read by
-- nothing until now, so every receptionist that is switched on would start
-- sending to patients the first night this ships. Off for everyone, and off
-- by default; the switches on Growth > Receptionist turn it on.
alter table public.receptionist_config alter column after_hours set default false;
update public.receptionist_config set after_hours = false where after_hours;
