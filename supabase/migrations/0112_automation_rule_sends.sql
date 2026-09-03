-- Backs the new appointment.hours_before trigger (any number of rules per
-- account, each with its own hours-before value in filters). Unlike the
-- other cron triggers (same_day, birthday), which guard against re-sending
-- with a single column on the target row because only one such rule ever
-- meaningfully applies per day, hours_before rules can coexist with
-- different offsets (24h and 72h reminders are two separate rules), so the
-- "already sent" guard has to be tracked per rule, not per appointment.
create table automation_rule_sends (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references automation_rules(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (rule_id, appointment_id)
);

alter table automation_rule_sends enable row level security;

create policy "Staff can view their account's automation rule sends"
on automation_rule_sends for select
using (is_account_member((select account_id from automation_rules where id = rule_id)));
