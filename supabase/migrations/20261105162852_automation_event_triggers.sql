-- Four more things that can start an automation (utils/automationCatalog.ts),
-- each raised where its event already happens:
--
--   satisfaction.answered  the patient's first score, from the satisfaction
--                          page (server/api/satisfaction/[token].post.ts);
--   patient.tag_added /    a tag changed by the team (FlagsPanel, through
--   patient.tag_removed    /api/automations/fire) or by an automation's tag step;
--   doc.completed          a form found completed by the 15-minute tick
--                          (enrolCompletedDocs, in lead-sequence-cron, which is
--                          already scheduled -- no new cron);
--   lead.stage_changed     a lead moved by the team or by an automation step.
--
-- Each rule's own setting for them (which tag, which score, which form,
-- which stage) lives in automation_rules.filters under trigger_* keys
-- (utils/automationTriggerMatch.ts), so no column changes.

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed'
  ]));

-- One row per (automation, form) started, claimed before the automation
-- runs, so a form starts each automation once however many ticks see it.
-- Written only by the tick (service role); nothing on screen reads it.
create table public.automation_doc_sends (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  doc_id uuid not null references public.patient_docs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (rule_id, doc_id)
);
create index automation_doc_sends_doc_idx on public.automation_doc_sends (doc_id);
create index automation_doc_sends_account_idx on public.automation_doc_sends (account_id);

-- RLS with no policy for staff: the service role is the only reader and writer.
alter table public.automation_doc_sends enable row level security;
select public.require_two_factor_on('public.automation_doc_sends');
select public.grant_data_api('public.automation_doc_sends');
