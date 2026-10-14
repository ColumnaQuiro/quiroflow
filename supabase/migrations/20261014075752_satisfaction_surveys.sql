-- "¿Qué tal te hemos atendido?" -- a 1-5 after a visit, sent by an
-- automation on the appointment.satisfaction trigger (after the first visit
-- and every Nth, never more than once a month per patient) through the
-- {{satisfaction_link}} variable, which mints one of these rows.
--
-- The patient answers on a public page by its token (/valorar/<token>,
-- /api/satisfaction/<token>, on the service role), the way review_requests
-- and waitlist claims work: no session, the token is the key. A 1-3 can add
-- what to improve and alerts the owners privately (staff_tasks); a 4-5 is
-- offered the clinic's Google review link.
--
-- Keyed by appointment, so the patient comes from the visit and there is no
-- patient_id here (merge_patients moves appointments, which carries these).
-- Staff read and resolve them on Growth > Reputation, under
-- communication_config like the rest of that page; only the service role
-- writes the rest.
create table public.satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  token text not null unique,
  sent_at timestamptz not null default now(),
  score smallint check (score between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  answered_at timestamptz,
  review_offered_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.team_members(id) on delete set null
);
create index satisfaction_surveys_account_sent_idx on public.satisfaction_surveys (account_id, sent_at desc);
create index satisfaction_surveys_rule_id_idx on public.satisfaction_surveys (rule_id);
create index satisfaction_surveys_resolved_by_idx on public.satisfaction_surveys (resolved_by);

alter table public.satisfaction_surveys enable row level security;

create policy "staff select satisfaction_surveys" on public.satisfaction_surveys for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));
-- Resolving a low score is the only change staff make.
create policy "staff update satisfaction_surveys" on public.satisfaction_surveys for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'communication_config'));

select public.require_two_factor_on('public.satisfaction_surveys');

-- The trigger that sends it: hours after a completed visit, the first visit
-- and every Nth (review-request-cron.post.ts handles both "after the visit"
-- triggers, so no new cron to schedule).
alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment'
  ]));
