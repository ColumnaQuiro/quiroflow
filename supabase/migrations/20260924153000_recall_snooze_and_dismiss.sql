-- Recalls: snooze that works, dismissals that can come back, and "overdue"
-- measured from the last visit the patient actually came to.
--
-- 1. Snooze. The Recalls page had a "Snooze 30 days" button that did nothing
--    -- there was no column to keep it in. recall_snoozed_until is that
--    column: while it is in the future the patient is out of the queue, and
--    on that day they are back, with nobody having to remember them. Written
--    by the page's Posponer dialog and by the "try again in 2 days" offer
--    after a call went unanswered; cleared by "Reactivar ya".
--
-- 2. Dismiss. recall_status = 'dismissed' was one-way: nothing ever set it
--    back, so a dismissed patient never reappeared -- not even after coming
--    back for more visits and lapsing again. recall_dismissed_at records
--    when, and the queue lets a dismissed patient back in once they have
--    attended a visit AFTER that moment: dismissing someone is a judgement
--    about that lapse, not about every future one. Written by the page's
--    Descartar action; "Restaurar" clears it and sets the status active.
--
-- 3. The last visit is the last one ATTENDED. The view counted any
--    non-cancelled appointment, so a no-show last week read as "seen last
--    week" and the patient dropped out of the overdue list. No-shows no longer
--    reset the clock; last_no_show_at is exposed so the page can say "No vino
--    el 16 sep" under the real last visit.
--
-- The view keeps every existing column, in order, and adds clinic_id (the
-- page follows the clinic selected in the sidebar) and last_no_show_at at the
-- end. It still means "who to contact now", which is what the sidebar badge
-- and the dashboard widget read it for -- a snoozed patient is correctly not
-- counted there. Snoozed and dismissed patients get their own view,
-- recall_parked, for the page's two other tabs.

alter table patients add column recall_snoozed_until date;
alter table patients add column recall_dismissed_at timestamptz;

create or replace view recall_candidates
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    p.first_name,
    p.last_name,
    p.email,
    p.tags,
    lb.balance_cents,
    p.recall_priority,
    p.default_practitioner_id,
    la.last_appointment_at,
    (current_date - la.last_appointment_at::date) as days_since_last_appointment,
    p.preferred_language,
    p.clinic_id,
    ln.last_no_show_at
  from patients p
  join lateral (
    select max(a.starts_at) as last_appointment_at
    from appointments a
    where a.patient_id = p.id and a.status not in ('cancelled', 'no_show') and a.deleted_at is null
  ) la on true
  left join lateral (
    select max(a.starts_at) as last_no_show_at
    from appointments a
    where a.patient_id = p.id and a.status = 'no_show' and a.deleted_at is null
  ) ln on true
  left join patient_live_balances lb on lb.patient_id = p.id
  where la.last_appointment_at is not null
    and not p.do_not_contact
    and not p.is_minor
    and (p.recall_snoozed_until is null or p.recall_snoozed_until <= current_date)
    and (
      p.recall_status = 'active'
      or (p.recall_status = 'dismissed' and p.recall_dismissed_at is not null and la.last_appointment_at > p.recall_dismissed_at)
    )
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.deleted_at is null and a2.starts_at > now()
    );

-- The two other tabs: patients out of the queue for now (snoozed), or until
-- they come back on their own (dismissed). A dismissed patient who has since
-- attended a visit is back in recall_candidates, so is not listed here.
create view recall_parked
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    p.clinic_id,
    p.first_name,
    p.last_name,
    p.default_practitioner_id,
    la.last_appointment_at,
    (current_date - la.last_appointment_at::date) as days_since_last_appointment,
    p.recall_snoozed_until,
    p.recall_dismissed_at,
    case when p.recall_status = 'dismissed' then 'dismissed' else 'snoozed' end as parked_as
  from patients p
  join lateral (
    select max(a.starts_at) as last_appointment_at
    from appointments a
    where a.patient_id = p.id and a.status not in ('cancelled', 'no_show') and a.deleted_at is null
  ) la on true
  where la.last_appointment_at is not null
    and not p.do_not_contact
    and not p.is_minor
    and (
      (p.recall_status = 'dismissed' and (p.recall_dismissed_at is null or la.last_appointment_at <= p.recall_dismissed_at))
      or (p.recall_status = 'active' and p.recall_snoozed_until > current_date)
    )
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.deleted_at is null and a2.starts_at > now()
    );
