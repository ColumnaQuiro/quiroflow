-- Automation triggers as atoms: a subject (an appointment, a patient, a
-- bono...), a moment of it (is booked, its start, their birthday...) and an
-- optional timing (24 hours before, 2 days after), with everything narrower
-- left to the "only if" filters. utils/automationTrigger.ts describes the
-- model; this is its column, and the backfill of every saved automation.
--
-- Backwards compatible on purpose. This migration is applied when the PR
-- merges, while the code ALREADY LIVE still reads trigger_event and the
-- trigger settings it keeps inside filters (hours_before, days_after,
-- trigger_tag...). So nothing is removed: trigger_event and those settings
-- stay exactly as they are, `trigger` is added beside them, and a BEFORE
-- trigger keeps `trigger` derived from them whenever that older code saves a
-- rule. The new code writes both (utils/automationTrigger.ts:
-- ruleColumnsForAtom), with trigger_event = 'atom' for an atom the old
-- triggers cannot say -- which the old code never selects, so it never fires
-- one twice or wrongly. Dropping trigger_event and the old settings is a
-- later PR, once a release with this code is live.
--
-- automation_trigger_from_legacy() is the same mapping as atomFromLegacy();
-- tests/unit/automation-trigger-atoms.test.ts pins the TypeScript one, and
-- scripts/verify-trigger-atoms.ts runs both over the same rules.
--
-- What an old trigger decided by itself is now an "only if" filter the
-- backfill adds (appointment_statuses, reminder_unanswered, visit_number,
-- not_rated_days, invoice_unpaid). The live code ignores keys it does not
-- know, so those change nothing until the new code reads them.
--
-- Restates 20261113144916_referred_patient_visit_trigger's trigger_event list, plus 'atom'.

-- ------------------------------------------------------------------ mapping

-- A JSON value as a number, the way JavaScript's Number() reads the values
-- these settings hold (a number, or a number written as a string); null for
-- anything else.
create or replace function public.automation_json_number(v jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(v #>> '{}')::numeric
    else null
  end
$$;

-- The keys of f that hold something: not missing, not null, not ''.
create or replace function public.automation_json_pick(f jsonb, keys text[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, f -> k), '{}'::jsonb)
  from unnest(keys) k
  where f ? k and jsonb_typeof(f -> k) <> 'null' and (f -> k) <> '""'::jsonb
$$;

create or replace function public.automation_trigger_from_legacy(p_event text, p_filters jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  n numeric;
  src text;
  days numeric;
  dir text;
  ev text := coalesce(p_event, '');
  atom jsonb;
  implied jsonb := '{}'::jsonb;
begin
  -- The same event, nothing else to carry.
  atom := case ev
    when 'appointment.booked' then '{"subject":"appointment","moment":"booked"}'
    when 'appointment.rescheduled' then '{"subject":"appointment","moment":"rescheduled"}'
    when 'appointment.cancelled' then '{"subject":"appointment","moment":"cancelled"}'
    when 'appointment.no_show' then '{"subject":"appointment","moment":"no_show"}'
    when 'appointment.checked_in' then '{"subject":"appointment","moment":"checked_in"}'
    when 'appointment.completed' then '{"subject":"appointment","moment":"completed"}'
    when 'invoice.paid' then '{"subject":"invoice","moment":"paid"}'
    when 'patient.referred' then '{"subject":"referral","moment":"referred"}'
    when 'membership.new_member' then '{"subject":"membership","moment":"started"}'
    when 'membership.removed' then '{"subject":"membership","moment":"cancelled"}'
    when 'membership.payment_processed' then '{"subject":"membership","moment":"charged"}'
    when 'waitlist.slot_offered' then '{"subject":"waitlist","moment":"slot_offered"}'
    when 'lead.created' then '{"subject":"lead","moment":"created"}'
    when 'segment' then '{"subject":"group","moment":"scheduled"}'
    else null
  end::jsonb;
  if atom is not null then
    return jsonb_build_object('trigger', atom || '{"timing":null,"options":{}}'::jsonb, 'implied', implied);
  end if;

  -- The same event, with the trigger's own setting as its option.
  atom := case ev
    when 'patient.tag_added' then jsonb_build_object('subject', 'patient', 'moment', 'tag_added', 'options', automation_json_pick(f, array['trigger_tag']))
    when 'patient.tag_removed' then jsonb_build_object('subject', 'patient', 'moment', 'tag_removed', 'options', automation_json_pick(f, array['trigger_tag']))
    when 'patient.type_added' then jsonb_build_object('subject', 'patient', 'moment', 'type_added', 'options', automation_json_pick(f, array['trigger_type_id', 'trigger_type_name']))
    when 'patient.type_removed' then jsonb_build_object('subject', 'patient', 'moment', 'type_removed', 'options', automation_json_pick(f, array['trigger_type_id', 'trigger_type_name']))
    when 'satisfaction.answered' then jsonb_build_object('subject', 'rating', 'moment', 'answered', 'options', automation_json_pick(f, array['trigger_score']))
    when 'doc.completed' then jsonb_build_object('subject', 'form', 'moment', 'completed', 'options', automation_json_pick(f, array['trigger_doc_template_ids']))
    when 'care_plan.milestone' then jsonb_build_object('subject', 'care_plan', 'moment', 'milestone', 'options', automation_json_pick(f, array['trigger_milestone', 'trigger_visit_number']))
    when 'lead.stage_changed' then jsonb_build_object('subject', 'lead', 'moment', 'stage_changed', 'options', automation_json_pick(f, array['trigger_lead_stage']))
    when 'audience.entered' then jsonb_build_object('subject', 'patient', 'moment', 'entered_audience', 'options', automation_json_pick(f, array['trigger_audience', 'include_current']))
    else null
  end;
  if atom is not null then
    return jsonb_build_object('trigger', atom || '{"timing":null}'::jsonb, 'implied', implied);
  end if;

  if ev = 'appointment.hours_before' then
    n := automation_json_number(f -> 'hours_before');
    implied := jsonb_build_object('appointment_statuses', jsonb_build_array('booked'));
    if (f -> 'skip_if_answered') is distinct from 'false'::jsonb then
      implied := implied || '{"reminder_unanswered":true}'::jsonb;
    end if;
    return jsonb_build_object(
      'trigger', jsonb_build_object('subject', 'appointment', 'moment', 'start', 'options', '{}'::jsonb,
        'timing', jsonb_build_object('amount', case when n > 0 then n else 24 end, 'unit', 'hours', 'direction', 'before')),
      'implied', implied);
  end if;

  if ev = 'appointment.same_day' then
    return jsonb_build_object(
      'trigger', '{"subject":"appointment","moment":"start","options":{},"timing":{"amount":0,"unit":"days","direction":"before","at":"09:00"}}'::jsonb,
      'implied', '{"appointment_statuses":["booked"]}'::jsonb);
  end if;

  if ev = 'appointment.review_request' then
    n := automation_json_number(f -> 'days_after');
    return jsonb_build_object(
      'trigger', jsonb_build_object('subject', 'appointment', 'moment', 'end', 'options', '{}'::jsonb,
        'timing', jsonb_build_object('amount', case when n > 0 then n else 2 end, 'unit', 'days', 'direction', 'after')),
      'implied', '{"appointment_statuses":["completed"]}'::jsonb);
  end if;

  if ev = 'appointment.satisfaction' then
    n := automation_json_number(f -> 'hours_after');
    return jsonb_build_object(
      'trigger', jsonb_build_object('subject', 'appointment', 'moment', 'end', 'options', '{}'::jsonb,
        'timing', jsonb_build_object('amount', case when n > 0 then n else 2 end, 'unit', 'hours', 'direction', 'after')),
      'implied', jsonb_build_object(
        'appointment_statuses', jsonb_build_array('completed'),
        'visit_number', jsonb_build_object(
          'first', (f -> 'first_visit') is distinct from 'false'::jsonb,
          'every', case when not (f ? 'every_visits') then 10 else greatest(0, coalesce(automation_json_number(f -> 'every_visits'), 0)) end),
        'not_rated_days', 30));
  end if;

  if ev = 'invoice.overdue' then
    n := automation_json_number(f -> 'days_overdue');
    return jsonb_build_object(
      'trigger', jsonb_build_object('subject', 'invoice', 'moment', 'issued', 'options', '{}'::jsonb,
        'timing', jsonb_build_object('amount', coalesce(nullif(n, 0), 7), 'unit', 'days', 'direction', 'after')),
      'implied', '{"invoice_unpaid":true}'::jsonb);
  end if;

  if ev = 'patient.birthday' then
    return jsonb_build_object(
      'trigger', '{"subject":"patient","moment":"birthday","options":{},"timing":{"amount":0,"unit":"days","direction":"after"}}'::jsonb,
      'implied', implied);
  end if;

  if ev = 'referral.visit_completed' then
    return jsonb_build_object(
      'trigger', '{"subject":"appointment","moment":"completed","timing":null,"options":{},"send_to":"referrer"}'::jsonb,
      'implied', implied);
  end if;

  if ev = 'bono.running_low' then
    n := automation_json_number(f -> 'trigger_sessions_left');
    return jsonb_build_object(
      'trigger', jsonb_build_object('subject', 'bono', 'moment', 'running_low', 'timing', null,
        'options', jsonb_build_object('trigger_sessions_left', case when n is not null and n >= 0 and n = trunc(n) then n else 1 end)),
      'implied', implied);
  end if;

  if ev = 'patient.date' then
    src := coalesce(f ->> 'trigger_date', '');
    days := automation_json_number(f -> 'trigger_days');
    if days is null or days < 0 or days > 3650 or days <> trunc(days) then
      days := 7;
    end if;
    dir := case when f ->> 'trigger_when' = 'before' and src like 'field:%' then 'before' else 'after' end;
    atom := case src
      when 'last_visit' then '{"subject":"patient","moment":"last_visit","options":{}}'::jsonb
      when 'membership_start' then '{"subject":"membership","moment":"started","options":{}}'::jsonb
      when 'care_plan_start' then '{"subject":"care_plan","moment":"started","options":{}}'::jsonb
      else jsonb_build_object('subject', 'patient', 'moment', 'date_field',
        'options', case when src like 'field:%' then jsonb_build_object('trigger_date', src) else '{}'::jsonb end)
    end;
    return jsonb_build_object(
      'trigger', atom || jsonb_build_object('timing', jsonb_build_object('amount', days, 'unit', 'days', 'direction', dir)),
      'implied', implied);
  end if;

  -- A trigger nothing knows: an atom that names nothing, and never fires.
  return jsonb_build_object(
    'trigger', jsonb_build_object('subject', 'group', 'moment', 'unknown:' || ev, 'timing', null, 'options', '{}'::jsonb),
    'implied', implied);
end;
$$;

-- The old triggers whose atoms imply filters are the only ones whose implied
-- keys a re-derivation may replace; every other rule's filters are kept as
-- they are.
create or replace function public.automation_filters_with_implied(p_event text, p_filters jsonb, p_implied jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_event in ('appointment.hours_before', 'appointment.same_day', 'appointment.review_request', 'appointment.satisfaction', 'invoice.overdue')
      then (case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end)
             - array['appointment_statuses', 'reminder_unanswered', 'visit_number', 'not_rated_days', 'invoice_unpaid']
             || coalesce(p_implied, '{}'::jsonb)
    else case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end
  end
$$;

-- ------------------------------------------------------------------ the column

alter table public.automation_rules add column trigger jsonb;

update public.automation_rules r
   set trigger = x.m -> 'trigger',
       filters = public.automation_filters_with_implied(r.trigger_event, r.filters, x.m -> 'implied')
  from (select id, public.automation_trigger_from_legacy(trigger_event, filters) as m from public.automation_rules) x
 where x.id = r.id;

-- Kept derived from trigger_event and filters while code that only knows
-- those can save a rule: on insert without a trigger, and on an update that
-- changed them without touching trigger. A save by the new code sets trigger
-- itself (and trigger_event 'atom' when the old triggers cannot say it), and
-- is left as it is.
create or replace function public.automation_rules_derive_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  m jsonb;
begin
  if new.trigger_event = 'atom' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.trigger is not null then
      return new;
    end if;
  else
    if new.trigger is distinct from old.trigger then
      return new;
    end if;
    if new.trigger_event is not distinct from old.trigger_event and new.filters is not distinct from old.filters then
      return new;
    end if;
  end if;
  m := automation_trigger_from_legacy(new.trigger_event, new.filters);
  new.trigger := m -> 'trigger';
  new.filters := automation_filters_with_implied(new.trigger_event, new.filters, m -> 'implied');
  return new;
end;
$$;

create trigger automation_rules_derive_trigger
  before insert or update on public.automation_rules
  for each row execute function public.automation_rules_derive_trigger();

alter table public.automation_rules alter column trigger set not null;
alter table public.automation_rules add constraint automation_rules_trigger_shape_check
  check (jsonb_typeof(trigger) = 'object' and trigger ? 'subject' and trigger ? 'moment');

-- The rules an event looks up: every enabled one of an account on a subject and moment.
create index automation_rules_atom_idx on public.automation_rules (account_id, (trigger ->> 'subject'), (trigger ->> 'moment')) where enabled;

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
    'care_plan.milestone', 'bono.running_low',
    'audience.entered',
    'patient.date',
    'patient.type_added', 'patient.type_removed',
    'referral.visit_completed',
    'atom'
  ]));

-- ------------------------------------------------------------------ claims

-- One row per (automation, thing that started it[, occurrence]) for the
-- moments the atoms added -- a patient added, a bono bought, an invoice
-- issued, a form sent, a care plan created, someone joining the waitlist --
-- and for timings no older trigger had. Claimed before the automation runs,
-- so each starts it once however many checks see it. The moments the older
-- triggers already had keep their own tables (automation_rule_sends,
-- automation_birthday_sends, automation_date_sends, automation_doc_sends,
-- automation_bono_sends, automation_invoice_sends) with the same keys, so
-- nothing they already sent is sent again when this code goes live.
--
-- source_id is the row the moment came from (an appointment, an invoice...),
-- never a patient, so merging or anonymising a patient needs nothing here.
-- Written only by the 15-minute check (service role); nothing on screen reads it.
create table public.automation_trigger_claims (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  source_id uuid not null,
  occurrence text not null default '',
  account_id uuid not null references public.accounts(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (rule_id, source_id, occurrence)
);
create index automation_trigger_claims_account_idx on public.automation_trigger_claims (account_id);

alter table public.automation_trigger_claims enable row level security;
select public.require_two_factor_on('public.automation_trigger_claims');
select public.grant_data_api('public.automation_trigger_claims');
