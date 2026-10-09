-- Moving an appointment re-arms its appointment.hours_before reminders.
--
-- Those rules guard against re-sending with a row in automation_rule_sends
-- per (rule, appointment) -- keyed by the appointment, never by the time it
-- was at. A reschedule keeps the same row and only changes starts_at, so the
-- guard written for the OLD time still reads "done" and the patient hears
-- nothing about the new one. One patient's appointment was moved from
-- 16 Sep to 29 Sep after both its 72h and 24h reminders had gone out, and
-- neither fired again for the 29th; three other upcoming appointments were in
-- the same state when this was found.
--
-- A reschedule is written from several places (the calendar drag, the
-- appointment panel, the public API, the PracticeHub importer and the mobile
-- app among them), so the reset lives here rather than in each of them.
--
-- The single-slot guards on the appointment row itself (reminder_sent_at,
-- same_day_info_sent_at) are deliberately NOT cleared here: the panel's
-- History tab is built from them, and clearing them would erase the record
-- that a reminder went out. Their crons tell a stale timestamp from a current
-- one instead (appointment-reminders-cron.post.ts, same-day-cron.post.ts).
--
-- Deleting the automation_rule_sends rows means a rescheduled appointment's
-- earlier reminder no longer counts toward that rule's "sent" figure in the
-- automation stats. The message itself is still counted from the message
-- log; only the guard row goes.
create or replace function public.reset_reminders_on_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    -- Only the rules measured from starts_at. review_request (days after)
    -- shares this table but is not a reminder about the upcoming time.
    delete from automation_rule_sends s
    using automation_rules r
    where s.appointment_id = new.id
      and r.id = s.rule_id
      and r.trigger_event = 'appointment.hours_before';
  end if;

  return new;
end;
$$;

-- Not an RPC: the trigger fires it as definer because automation_rule_sends
-- has no delete policy, so under the staff member's own RLS the delete above
-- would silently remove nothing.
revoke all on function public.reset_reminders_on_reschedule() from public, anon, authenticated;

drop trigger if exists reset_reminders_on_reschedule on appointments;
create trigger reset_reminders_on_reschedule
  after update of starts_at on appointments
  for each row execute function public.reset_reminders_on_reschedule();
