-- A lead converted to a patient is one person with one thread: the patient's.
--
-- Conversion set leads.patient_id and moved nothing else, so the person had
-- two conversations in the Inbox from then on. The lead's thread kept every
-- message from before (keyed lead:<id>, read strictly by lead_id), and the
-- patient's collected everything after -- the reminders, their replies,
-- anything sent from the patient's record. Which one a reply landed in
-- depended on which row someone happened to open, internal notes could only
-- be written on one of them, and a reply from the lead's thread in the app
-- went out addressed by number alone and turned up as a third.
--
-- Now conversion folds the lead's thread into the patient's:
--
--   * its messages take the patient_id (lead_id is kept, so the lead's own
--     page in Growth still shows the conversation that won them), which is
--     what files them under the patient's key in inbox_conversations;
--   * the per-conversation state keyed lead:<id> -- who it is assigned to,
--     each person's read time, snooze, archive and labels, and the notes --
--     moves to the patient's key, so nothing anyone did on the lead's thread
--     is lost in the move.
--
-- /api/growth/conversations stops listing converted leads in the same change,
-- so the lead's row leaves the list as its messages arrive in the patient's.
--
-- A trigger rather than the convert route, because that route is not the
-- only way a lead gets its patient: a lead can be linked to a patient that
-- already exists, and any future path is covered without remembering this.
-- If the patient is later deleted, whatsapp_messages.patient_id and
-- leads.patient_id are both ON DELETE SET NULL, so the messages fall back to
-- the lead's thread rather than going with the patient.

create or replace function public.fold_lead_thread_into_patient(p_lead_id uuid, p_account_id uuid, p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_key text := 'lead:' || p_lead_id::text;
  new_key text := p_patient_id::text;
begin
  update whatsapp_messages
     set patient_id = p_patient_id
   where account_id = p_account_id and lead_id = p_lead_id and patient_id is null;

  -- The team's: whoever had the lead keeps the person, unless the patient's
  -- thread already has somebody.
  insert into inbox_assignments (account_id, conversation_key, team_member_id, assigned_by, assigned_at)
  select account_id, new_key, team_member_id, assigned_by, assigned_at
    from inbox_assignments where account_id = p_account_id and conversation_key = old_key
  on conflict (account_id, conversation_key) do nothing;
  delete from inbox_assignments where account_id = p_account_id and conversation_key = old_key;

  -- Each person's own. A read keeps the later of the two, so what someone
  -- had already read on either thread stays read.
  insert into inbox_reads (account_id, team_member_id, conversation_key, last_read_at)
  select account_id, team_member_id, new_key, last_read_at
    from inbox_reads where account_id = p_account_id and conversation_key = old_key
  on conflict (team_member_id, conversation_key)
  do update set last_read_at = greatest(inbox_reads.last_read_at, excluded.last_read_at);
  delete from inbox_reads where account_id = p_account_id and conversation_key = old_key;

  insert into inbox_snoozes (account_id, team_member_id, conversation_key, snoozed_until, created_at)
  select account_id, team_member_id, new_key, snoozed_until, created_at
    from inbox_snoozes where account_id = p_account_id and conversation_key = old_key
  on conflict (team_member_id, conversation_key) do nothing;
  delete from inbox_snoozes where account_id = p_account_id and conversation_key = old_key;

  insert into whatsapp_conversation_archives (account_id, team_member_id, conversation_key, archived_at)
  select account_id, team_member_id, new_key, archived_at
    from whatsapp_conversation_archives where account_id = p_account_id and conversation_key = old_key
  on conflict (team_member_id, conversation_key) do nothing;
  delete from whatsapp_conversation_archives where account_id = p_account_id and conversation_key = old_key;

  insert into whatsapp_conversation_labels (account_id, team_member_id, conversation_key, label_id, created_at)
  select account_id, team_member_id, new_key, label_id, created_at
    from whatsapp_conversation_labels where account_id = p_account_id and conversation_key = old_key
  on conflict (team_member_id, conversation_key, label_id) do nothing;
  delete from whatsapp_conversation_labels where account_id = p_account_id and conversation_key = old_key;

  -- Notes have their own ids; they only change which thread they sit in.
  update inbox_notes set conversation_key = new_key
   where account_id = p_account_id and conversation_key = old_key;
end;
$function$;

revoke all on function public.fold_lead_thread_into_patient(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.leads_fold_thread_on_conversion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.fold_lead_thread_into_patient(new.id, new.account_id, new.patient_id);
  return null;
end;
$function$;

create trigger leads_fold_thread_on_conversion
  after update of patient_id on public.leads
  for each row
  when (new.patient_id is not null and new.patient_id is distinct from old.patient_id)
  execute function public.leads_fold_thread_on_conversion();

-- The leads already converted before this.
select public.fold_lead_thread_into_patient(id, account_id, patient_id)
  from public.leads
 where patient_id is not null;

-- And the replies that went out between conversion and now addressed by
-- number alone, filed under nobody (inboxSend and whatsapp/send now give them
-- the patient). Only where exactly one converted lead in the account has that
-- number, so there is no doubt whose they are.
update public.whatsapp_messages m
   set patient_id = l.patient_id
  from public.leads l
 where m.account_id = l.account_id
   and m.phone_number = l.phone
   and m.patient_id is null
   and m.lead_id is null
   and l.patient_id is not null
   and l.converted_at is not null
   and m.created_at >= l.converted_at
   and not exists (
     select 1 from public.leads other
      where other.account_id = l.account_id and other.phone = l.phone
        and other.patient_id is not null and other.id <> l.id
   );
