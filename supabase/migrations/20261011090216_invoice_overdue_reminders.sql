-- Reminders for unpaid invoices, as an automation trigger: "invoice.overdue",
-- N days after an invoice was raised and still owed (filters.days_overdue,
-- as appointment.hours_before keeps its hours). A clinic writes the message
-- itself -- a WhatsApp template or an email -- with the amount and a link to
-- pay by card in it, and can have a second automation at another N for a
-- second reminder. Checked once a day by the daily automations cron.
--
-- invoices.pay_token: the stable link a reminder carries (/api/pay/<token>).
-- A Stripe Checkout page lives 24 hours, far less than a reminder sits in
-- someone's WhatsApp, so the link makes a fresh one each time it is opened,
-- for whatever is still owed then. Made when first needed.
--
-- patients.invoice_reminders_paused: "do not remind this patient" -- a
-- payment plan agreed at the desk, a family that pays monthly. Skipped by
-- every invoice.overdue automation.
--
-- automation_invoice_sends: one row per (automation, invoice) sent, so a
-- reminder goes once whatever the cron does; read by the patient's Billing
-- tab to say when they were last reminded.

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'lead.created',
    'waitlist.slot_offered', 'segment'
  ]));

alter table public.invoices add column pay_token uuid unique;

alter table public.patients add column invoice_reminders_paused boolean not null default false;

create table public.automation_invoice_sends (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (rule_id, invoice_id)
);
create index automation_invoice_sends_invoice_idx on public.automation_invoice_sends (invoice_id);
create index automation_invoice_sends_account_idx on public.automation_invoice_sends (account_id);

alter table public.automation_invoice_sends enable row level security;
-- Written only by the cron (service role); read by staff who see billing.
create policy "billing staff read automation_invoice_sends" on public.automation_invoice_sends
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'billing_access'));
select public.require_two_factor_on('public.automation_invoice_sends');

grant select on public.automation_invoice_sends to authenticated;
