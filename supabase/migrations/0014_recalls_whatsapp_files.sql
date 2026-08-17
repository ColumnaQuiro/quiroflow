-- Recalls queue, WhatsApp send config (per-account, webhook-based so any
-- automation tool -- n8n today, a direct Cloud API integration later --
-- can be the actual sender), and patient file attachments.

alter table patients add column recall_status text not null default 'active'
  check (recall_status in ('active', 'dismissed'));
alter table patients add column recall_priority boolean not null default false;

-- WhatsApp is sent by POSTing to this account's own webhook (e.g. an n8n
-- flow) rather than QuiroFlow talking to a WhatsApp API directly -- lets
-- each clinic keep whatever WhatsApp Business setup they already have.
alter table accounts add column whatsapp_webhook_url text;
alter table accounts add column recall_whatsapp_template text
  not null default 'Hi {{first_name}}, it''s been a while since your last visit to {{clinic_name}}. Would you like to book your next appointment?';
alter table accounts add column confirmation_whatsapp_template text
  not null default 'Hi {{first_name}}, this confirms your appointment at {{clinic_name}} on {{appointment_date}} at {{appointment_time}}.';

-- Every recall contact attempt and confirmation send, so the recall queue
-- can show "last action" and staff aren't guessing who already called.
create table contact_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  action text not null
    check (action in ('sent_whatsapp', 'called_no_answer', 'called_left_message', 'booked', 'other')),
  note text,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index contact_log_patient_idx on contact_log (account_id, patient_id, created_at desc);

alter table contact_log enable row level security;
create policy "staff manage contact_log" on contact_log
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- Patient file attachments (posture photos, reports, signed consent forms).
create table patient_files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_type text,
  size_bytes bigint,
  uploaded_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index patient_files_patient_idx on patient_files (account_id, patient_id, created_at desc);

alter table patient_files enable row level security;
create policy "staff manage patient_files" on patient_files
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

insert into storage.buckets (id, name, public)
values ('patient-files', 'patient-files', false)
on conflict (id) do nothing;

-- Object paths are "<account_id>/<patient_id>/<filename>" -- the first
-- path segment gates access the same way every other table does.
create policy "staff manage patient-files storage" on storage.objects
  for all using (
    bucket_id = 'patient-files' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'patient-files' and is_account_member((storage.foldername(name))[1]::uuid)
  );

-- Recall candidates: patients with a past appointment, no future one, and
-- not dismissed. security_invoker so it honors the querying user's own
-- RLS (same tenant isolation as querying patients/appointments directly)
-- instead of running as the view owner.
create view recall_candidates
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
    (current_date - la.last_appointment_at::date) as days_since_last_appointment
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
