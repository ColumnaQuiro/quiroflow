-- The times the AI receptionist offered, kept as data.
--
-- Until now an offer existed only as the text of the message that made it.
-- The code knew the exact times when it sent them, then let them go: when the
-- person tapped one, it read its own message back with regular expressions,
-- wrote the model a note asking it to book, and the model chose the day, the
-- time, the type and the chiropractor a second time. In the first two days on
-- Haiku (21-23 Nov 2026) that chain lost something at three different links:
-- a turn that came back with no words after offer_times (twice), a time
-- offered "with another chiropractor" and booked with their own, and a time
-- a colleague had offered handed to a person instead of booked. Each had been
-- patched with another line in the prompt.
--
-- A row here is one offer the receptionist sent: its times, what they were
-- for (a type, or the visit being moved) and who each was free with when it
-- was checked. A time accepted from it is booked by code, from this row
-- (server/utils/receptionistOffers.ts), and the 15-minute handover job looks
-- for a time somebody accepted that the diary does not have.
--
-- Like receptionist_reply_traces and receptionist_slot_holds, it is about the
-- conversation, not the person: the Inbox's conversation key (a patient's id,
-- or lead:<id>) as text, dates, times, a type's name and a practitioner's --
-- never the patient's name, a number or any of their words. So nothing here
-- needs moving by merge_patients or removing by anonymize_patient: an offer
-- whose patient is gone is accepted by nobody, and closes itself in a week.

create table public.receptionist_offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- A patient's id, or lead:<id>.
  conversation_key text not null,
  -- [{ date: 'YYYY-MM-DD', time: 'HH:MM', practitionerId, practitionerName }]
  -- on the clinic's clock, in the order offered.
  slots jsonb not null,
  -- What a new visit would be; null for a move, which keeps the visit's type.
  type_name text,
  -- The visit being moved, as 'YYYY-MM-DD HH:MM' on the clinic's clock.
  move_visit_on text,
  -- Each time is only with the chiropractor it was offered with.
  pinned boolean not null default false,
  -- With whoever of the team is free.
  any_chiropractor boolean not null default false,
  -- Whether code may book an accepted time on its own: for the person
  -- writing, of a type or a move it resolved, every time checked free.
  auto boolean not null default false,
  -- 'open' until it is accepted and booked ('booked'), replaced by a newer
  -- offer or a booking made some other way ('superseded'), or found accepted
  -- with no visit in the diary and passed to a person ('alerted').
  status text not null default 'open' check (status in ('open', 'booked', 'superseded', 'alerted')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index receptionist_offers_open on public.receptionist_offers (account_id, conversation_key, created_at desc) where status = 'open';
create index receptionist_offers_open_by_age on public.receptionist_offers (created_at) where status = 'open';

alter table public.receptionist_offers enable row level security;
-- Read by whoever configures the receptionist; written only by the service role.
create policy "receptionist config staff read receptionist_offers" on public.receptionist_offers
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.receptionist_offers');
select public.grant_data_api('public.receptionist_offers');
