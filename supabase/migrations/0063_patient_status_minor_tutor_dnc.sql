-- Patient lifecycle status (active/inactive, staff-set -- distinct from
-- recall_status which only gates the recall queue), minor/tutor linking,
-- and a "do not contact" flag that blocks all outbound communication.

alter table patients add column status text not null default 'active'
  check (status in ('active', 'inactive'));

alter table patients add column is_minor boolean not null default false;
alter table patients add column tutor_patient_id uuid references patients(id) on delete set null;
alter table patients add column do_not_contact boolean not null default false;

create index patients_tutor_idx on patients (tutor_patient_id) where tutor_patient_id is not null;

-- Minors and do-not-contact patients are never recall candidates -- the
-- entire point of the recall queue is prompting staff to contact someone.
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
    and not p.do_not_contact
    and not p.is_minor
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.starts_at > now()
    );

-- Public bucket for campaign email images -- unlike patient-files, these
-- need to render in a recipient's email client with no auth, so a signed
-- URL (which expires) won't work. Path is "<account_id>/<filename>" so the
-- read policy can still scope writes to account staff.
insert into storage.buckets (id, name, public)
values ('campaign-images', 'campaign-images', true)
on conflict (id) do nothing;

create policy "staff manage campaign-images storage" on storage.objects
  for all using (
    bucket_id = 'campaign-images' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'campaign-images' and is_account_member((storage.foldername(name))[1]::uuid)
  );
