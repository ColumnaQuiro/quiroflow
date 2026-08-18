-- A configurable default recall template (mirrors the existing
-- confirmation template columns), and preferred_language on the recall
-- queue so the recall send flow can language-match the same way the
-- confirmation flow already does.

alter table accounts add column whatsapp_recall_template_name text;
alter table accounts add column whatsapp_recall_template_language text not null default 'es';

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
    p.balance_cents,
    p.recall_priority,
    p.default_practitioner_id,
    la.last_appointment_at,
    (current_date - la.last_appointment_at::date) as days_since_last_appointment,
    p.preferred_language
  from patients p
  join lateral (
    select max(a.starts_at) as last_appointment_at
    from appointments a
    where a.patient_id = p.id and a.status <> 'cancelled'
  ) la on true
  where la.last_appointment_at is not null
    and p.recall_status = 'active'
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.starts_at > now()
    );
