-- Which automation, and which step of it, a message or a history row belongs to.
--
-- The Campaigns page counted a rule's WhatsApp sends by joining
-- whatsapp_messages to the rule on template_name, because nothing on the
-- message said which rule sent it. Two automations using the same template
-- therefore shared -- and doubled -- each other's figures, and a manual send of
-- that template from the Inbox was counted as the automation's. The new
-- Automations screen reports per rule and per step, so the sender now records
-- both on the row it already writes.
--
-- Additive and nullable. Rows written before this carry NULL and are simply
-- not attributed to any automation: there is no reliable way to work out
-- afterwards which rule sent a given template, which was the bug. Code that is
-- already live keeps inserting without these columns and is unaffected.

-- whatsapp_messages -> automation_rules is the first relationship between the
-- two tables, so no existing embed becomes ambiguous.
-- compat-ok: the embeds the check lists are automation_rules(...) from
-- automation_sequence_runs, which has its one foreign key to automation_rules
-- and gains none. No many-to-many path appears either: whatsapp_messages'
-- key is its own id, not the pair of foreign keys, which is what PostgREST
-- needs to treat it as a junction -- email_messages.rule_id has had the same
-- shape since 20260918151828 with those embeds working.
alter table public.whatsapp_messages
  add column rule_id uuid references public.automation_rules(id) on delete set null,
  -- No foreign key: a step deleted from the builder leaves its old messages
  -- where they are, and a stale id only means they count towards no step.
  add column automation_action_id uuid;

create index whatsapp_messages_rule_idx on public.whatsapp_messages (account_id, rule_id, created_at desc) where rule_id is not null;

alter table public.email_messages
  add column automation_action_id uuid;

-- The step a history row is about, so the builder can say how many people
-- each step has sent, tagged or branched. position and step_label stay as
-- they were: they describe the step as it was when the row was written.
alter table public.automation_run_events
  add column action_id uuid;

create index automation_run_events_action_idx on public.automation_run_events (action_id, created_at desc) where action_id is not null;
