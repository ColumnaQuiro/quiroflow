-- Lead conversations, and who is answering them.
--
-- Deliberately NOT a new messages table. whatsapp_messages is already this
-- app's general message store rather than a WhatsApp-only one -- patient_id
-- is nullable, phone_number exists for people who are not patients yet, and
-- `channel` distinguishes WhatsApp from in-app. The Inbox reads it, the 24h
-- window logic guards it, and the webhook writes to it.
--
-- A parallel lead_messages table would have meant two stores, two composers,
-- two unread counts and a conversation that has to hop between them the
-- moment a lead converts -- which is precisely the outcome the merged-inbox
-- decision was made to avoid. Linking instead makes "one person, one thread"
-- literally true: the same rows, gaining a lead_id.

alter table whatsapp_messages add column lead_id uuid references leads(id) on delete set null;

-- Both, not either. A converted lead's thread stays attached to the lead it
-- came from AND the patient it became, so the acquisition history does not
-- detach the moment someone becomes a patient.
create index whatsapp_messages_lead_idx on whatsapp_messages (lead_id) where lead_id is not null;

-- Who is answering. `ai_handling` was a boolean, which cannot express the
-- three states that matter to whoever is looking at the thread: the AI is
-- mid-conversation, a person has taken it off the AI, or the AI has stopped
-- and is waiting for a human.
--
-- 'blocked' is separate from 'needs_human' on purpose. Needs-human is a
-- decision the AI made; blocked is the channel being down -- nothing can be
-- sent at all -- and the thing to do about it is reconnect a number, not
-- write a reply.
alter table leads add column ai_state text not null default 'none'
  check (ai_state in ('none', 'handling', 'paused', 'needs_human', 'blocked'));

alter table leads add column ai_taken_over_by uuid references team_members(id) on delete set null;
alter table leads add column ai_taken_over_at timestamptz;

update leads set ai_state = case when ai_handling then 'handling' else 'none' end;

create index leads_account_ai_state_idx on leads (account_id, ai_state) where deleted_at is null;

-- ai_handling is kept and kept in sync rather than dropped. Same reasoning as
-- the account_secrets migration: a deploy where the old code is still running
-- against the new schema must not break, and the board's API reads this
-- column today. The trigger makes the two incapable of drifting, which is
-- what makes removing the column later a safe one-line change rather than a
-- hunt for readers.
create or replace function leads_sync_ai_handling()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- An insert may set either field. ai_state wins where both are given,
    -- since it is the one with more to say.
    if new.ai_state is distinct from 'none' then
      new.ai_handling := (new.ai_state = 'handling');
    elsif new.ai_handling then
      new.ai_state := 'handling';
    end if;
    return new;
  end if;

  if new.ai_state is distinct from old.ai_state then
    new.ai_handling := (new.ai_state = 'handling');
  elsif new.ai_handling is distinct from old.ai_handling then
    new.ai_state := case when new.ai_handling then 'handling' else 'none' end;
  end if;
  return new;
end;
$$;

create trigger leads_sync_ai_handling
  before insert or update on leads
  for each row
  execute function leads_sync_ai_handling();
