-- An audit trail an owner can actually answer questions with.
--
-- audit_logs (0058) has recorded appointment and patient changes since
-- August, and payment-method corrections since 29 Sep. An audit of it on
-- 8 Oct 2026 found what it could not answer:
--
--   * Clinical notes. visit_notes can be edited and deleted by anyone with
--     visit_notes_edit, and nothing kept the earlier text. A note rewritten a
--     week after the visit looked exactly like one written on the day.
--   * Who can do what. Roles, team members, invites, API tokens, webhooks,
--     the clinic's settings and the VeriFactu certificate all changed with no
--     record -- including a member being given more permissions.
--   * Money after it was taken. payments, invoices, credits and bonos carried
--     created_by and nothing more; a void, an edit or a delete left no trace.
--   * What was deleted. A deleted patient left the word "Deleted" and an id
--     that no longer resolves to anyone.
--   * Who, through the server. 47 staff endpoints write with the service
--     role, which has no auth.uid(), so the trigger recorded nobody. 2,647 of
--     4,050 patient updates have no actor.
--   * Who looked. Nothing recorded opening a patient's record, viewing or
--     downloading their files, or exporting the patient list.
--   * Who signed in. auth.audit_log_entries is not written on this project,
--     and Supabase's own auth log is short-lived and not per clinic.
--
-- This migration closes all of those. The owner reads it at Settings ->
-- Activity log (pages/settings/activity.vue), through the get_* functions at
-- the bottom.

-- Every lock this migration needs, taken at once and audit_logs last. It
-- alters audit_logs and then adds triggers to tables whose writes insert into
-- audit_logs; taken one at a time, a patient being saved mid-migration holds
-- `patients` and waits for `audit_logs` while this holds `audit_logs` and
-- waits for `patients` -- a deadlock, which is exactly what happened the
-- first time this ran against a database in use. Writers wait out the
-- migration instead; it takes well under a second.
lock table
  patients, appointments, visit_notes, patient_files, patient_docs, payments, invoices,
  account_credits, package_purchases, patient_memberships, cash_shifts, cash_movements,
  team_members, team_member_clinics, account_roles, account_invites, api_tokens, webhooks,
  accounts, clinics, verifactu_certificates, verifactu_delegations, appointment_types,
  packages, memberships, services_products, audit_logs
  in share row exclusive mode;

-- 1. audit_logs gains structure ---------------------------------------------
--
-- `summary` stays exactly as it was: utils/appointmentActivity.ts parses the
-- appointment sentences back for the calendar panel. The new columns carry
-- what a sentence cannot:
--
--   changes      {column: {from, to}} for an update
--   snapshot     the whole row, at creation and at deletion -- so a deleted
--                record can still be read, and an edited note's first
--                version is there to compare against
--   actor        who kind of caller made it (see audit_actor below)
--   actor_name   the team member's name AT THE TIME. team_member_id is
--                `on delete set null`, so without this a departed member's
--                changes would become anonymous.
--   patient_id   the patient this concerns, for "everything about this
--                person". No foreign key, on purpose: the trail has to
--                outlive the patient row, and a key would either cascade it
--                away or block deleting the patient.
alter table audit_logs
  add column changes jsonb,
  add column snapshot jsonb,
  add column actor text check (actor in ('staff', 'patient', 'user', 'public', 'server', 'system')),
  add column actor_detail text,
  add column actor_name text,
  add column patient_id uuid;

-- Rows written before today: who it was is all they ever recorded.
update audit_logs l
set actor = case when l.team_member_id is not null then 'staff' end,
    actor_name = (select tm.full_name from team_members tm where tm.id = l.team_member_id),
    patient_id = case l.entity_type
      when 'patient' then l.entity_id
      when 'appointment' then (select a.patient_id from appointments a where a.id = l.entity_id)
    end;

alter table audit_logs drop constraint audit_logs_entity_type_check;
alter table audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in (
    'appointment', 'patient', 'payment', 'visit_note', 'invoice', 'account_credit',
    'package_purchase', 'patient_membership', 'patient_file', 'patient_doc',
    'team_member', 'team_member_clinic', 'role', 'account', 'clinic', 'invite',
    'api_token', 'webhook', 'verifactu_certificate', 'verifactu_delegation',
    'cash_shift', 'cash_movement', 'package', 'membership', 'service', 'appointment_type'
  ));

create index audit_logs_patient_idx on audit_logs (account_id, patient_id, created_at desc) where patient_id is not null;
create index audit_logs_team_member_idx on audit_logs (account_id, team_member_id, created_at desc);

-- 2. Who did it ---------------------------------------------------------------
--
--   staff    a team member, signed in -- or through one of our server routes
--            (below)
--   patient  a signed-in patient of this clinic: the patient app
--   user     signed in, but neither: someone creating their clinic, before
--            their team_members row exists. actor_detail is their email.
--   public   no session at all: online booking, a doc filled by link
--   server   our server with no person behind it: a webhook, a cron
--   system   straight into the database: a migration, the SQL editor,
--            pg_cron. actor_detail names the database role.
--
-- The server routes write with the service role, which carries no auth.uid().
-- So the auth guards in server/utils/requirePermission.ts hand the service
-- client the caller's team member as an `x-audit-actor` request header, and
-- PostgREST exposes request headers to the transaction. That header is
-- believed ONLY when the request's role is service_role: a browser can send
-- any header it likes, but it cannot sign a service_role JWT, so it cannot
-- name someone else as the author of its own write. It must also name a
-- member of the row's own account.
create or replace function public.audit_actor(p_account_id uuid, out team_member_id uuid, out actor text, out actor_detail text, out actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_role text;
  v_header text;
  v_uid uuid := auth.uid();
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_role := coalesce(v_claims ->> 'role', '');

  if v_uid is not null then
    select tm.id, tm.full_name into team_member_id, actor_name
    from public.team_members tm
    where tm.account_id = p_account_id and tm.user_id = v_uid;
    if team_member_id is not null then
      actor := 'staff';
    elsif exists (select 1 from public.patients p where p.account_id = p_account_id and p.user_id = v_uid) then
      actor := 'patient';
    else
      -- Signed in, but neither staff nor a patient here yet: someone creating
      -- their clinic, before their own team_members row exists.
      actor := 'user';
      select u.email into actor_detail from auth.users u where u.id = v_uid;
    end if;
    return;
  end if;

  if v_role = 'service_role' then
    begin
      v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-actor';
    exception when others then
      v_header := null;
    end;
    if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select tm.id, tm.full_name into team_member_id, actor_name
      from public.team_members tm
      where tm.id = v_header::uuid and tm.account_id = p_account_id;
    end if;
    actor := case when team_member_id is not null then 'staff' else 'server' end;
    return;
  end if;

  if v_role = 'anon' then
    actor := 'public';
    return;
  end if;

  actor := 'system';
  actor_detail := session_user::text;
end;
$$;
revoke all on function public.audit_actor(uuid) from public, anon, authenticated;

-- Credentials live inline on some of these rows -- accounts carries the
-- clinic's Stripe secret key, WhatsApp, Meta and PracticeHub tokens; invites
-- and patient_docs carry link tokens; verifactu_certificates the certificate
-- itself. The trail records THAT one changed, never its value. Matched by
-- name so a credential column added later is covered without anyone
-- remembering to list it here.
create or replace function public.audit_is_secret(p_column text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_column ~ '(secret|token|password|api_key|_hash$|pkcs12|base64)';
$$;
revoke all on function public.audit_is_secret(text) from public, anon, authenticated;

create or replace function public.audit_redact(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(
    r.key,
    case when public.audit_is_secret(r.key) and r.value <> 'null'::jsonb then '"[redacted]"'::jsonb else r.value end
  )
  from jsonb_each(p_row) r;
$$;
revoke all on function public.audit_redact(jsonb) from public, anon, authenticated;

-- Compared on the raw values and redacted afterwards: redacting first would
-- make a rotated key look unchanged and drop it from the trail.
create or replace function public.audit_diff(p_old jsonb, p_new jsonb, p_ignore text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(
    n.key,
    case when public.audit_is_secret(n.key)
      then jsonb_build_object('from', '[redacted]', 'to', '[redacted]')
      else jsonb_build_object('from', o.value, 'to', n.value)
    end
  )
  from jsonb_each(p_new) n
  join jsonb_each(p_old) o on o.key = n.key
  where n.value is distinct from o.value
    and not (n.key = any (p_ignore));
$$;
revoke all on function public.audit_diff(jsonb, jsonb, text[]) from public, anon, authenticated;

-- 3. The trigger --------------------------------------------------------------
--
-- One function for every audited table: fn_audit_log(<entity type>,
-- <comma-separated columns to ignore>). Kept under its 0058 name so the
-- appointment and patient triggers that already call it pick this up
-- unchanged.
--
-- Ignored columns are bookkeeping that something recomputes, not a decision
-- anybody made -- accounts.next_invoice_number moves on every invoice,
-- api_tokens.last_used_at on every API call. An update that touches nothing
-- else writes no row.
--
-- Appointments keep their 0058 behaviour exactly: logged only when status,
-- time, practitioner, room or type changes (or the visit is deleted), with
-- the same summary sentences, because the calendar panel parses them. The
-- confirmation and check-in timestamps are elsewhere on screen and change
-- constantly.
create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := TG_ARGV[0];
  v_ignore text[] := array['created_at', 'updated_at']
    || coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}'::text[]);
  v_old jsonb := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_account_id uuid;
  v_entity_id uuid;
  v_patient_id uuid;
  v_action text;
  v_summary text;
  v_changes jsonb;
  v_snapshot jsonb;
  v_actor record;
begin
  v_account_id := case when TG_TABLE_NAME = 'accounts' then (v_row ->> 'id')::uuid else (v_row ->> 'account_id')::uuid end;
  -- team_member_clinics has no account_id of its own.
  if v_account_id is null and v_row ? 'team_member_id' then
    select tm.account_id into v_account_id from public.team_members tm where tm.id = (v_row ->> 'team_member_id')::uuid;
  end if;
  if v_account_id is null then
    return null;
  end if;

  -- The whole account is being deleted and this row is going with it. Its
  -- audit_logs rows are going too (account_id cascades), and inserting one
  -- now would fail its foreign key and refuse the account delete outright.
  if TG_OP = 'DELETE' and not exists (select 1 from public.accounts a where a.id = v_account_id) then
    return null;
  end if;

  v_entity_id := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'team_member_id')::uuid, v_account_id);

  if TG_OP = 'INSERT' then
    v_action := 'created';
    v_summary := 'Created';
  elsif TG_OP = 'DELETE' then
    v_action := 'deleted';
    v_summary := 'Deleted';
  else
    v_action := 'updated';
  end if;

  if TG_OP = 'UPDATE' and v_entity_type = 'appointment' then
    if OLD.status is distinct from NEW.status then
      v_summary := coalesce(v_summary || '; ', '') || 'Status changed from ' || OLD.status || ' to ' || NEW.status;
    end if;
    if OLD.starts_at is distinct from NEW.starts_at then
      v_summary := coalesce(v_summary || '; ', '') || 'Rescheduled to ' || to_char(NEW.starts_at, 'DD Mon HH24:MI');
    end if;
    if OLD.practitioner_id is distinct from NEW.practitioner_id then
      v_summary := coalesce(v_summary || '; ', '') || 'Practitioner changed';
    end if;
    if OLD.room_id is distinct from NEW.room_id then
      v_summary := coalesce(v_summary || '; ', '') || 'Room changed';
    end if;
    if OLD.appointment_type_id is distinct from NEW.appointment_type_id then
      v_summary := coalesce(v_summary || '; ', '') || 'Type changed';
    end if;
    -- A soft delete. Worded as the 0058 hard delete was, which the panel
    -- already reads.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_summary := 'Deleted';
      v_action := 'deleted';
    end if;
    if v_summary is null then
      return null;
    end if;
    v_changes := public.audit_diff(
      v_old - array(select k from jsonb_object_keys(v_old) k where k not in ('status', 'starts_at', 'ends_at', 'practitioner_id', 'room_id', 'appointment_type_id', 'deleted_at')),
      v_new,
      '{}'::text[]
    );
  elsif TG_OP = 'UPDATE' then
    v_changes := public.audit_diff(v_old, v_new, v_ignore);
    if v_changes is null then
      return null;
    end if;
    v_summary := 'Updated: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(v_changes) k);
  end if;

  if TG_OP in ('INSERT', 'DELETE') then
    v_snapshot := public.audit_redact(v_row);
  end if;

  if v_entity_type = 'patient' then
    v_patient_id := v_entity_id;
  elsif v_row ? 'patient_id' then
    v_patient_id := (v_row ->> 'patient_id')::uuid;
  elsif v_entity_type = 'visit_note' then
    select a.patient_id into v_patient_id from public.appointments a where a.id = (v_row ->> 'appointment_id')::uuid;
  end if;

  select * into v_actor from public.audit_actor(v_account_id);

  insert into public.audit_logs (
    account_id, entity_type, entity_id, action, summary, team_member_id,
    actor, actor_detail, actor_name, changes, snapshot, patient_id
  ) values (
    v_account_id, v_entity_type, v_entity_id, v_action, v_summary, v_actor.team_member_id,
    v_actor.actor, v_actor.actor_detail, v_actor.actor_name, v_changes, v_snapshot, v_patient_id
  );

  return null;
end;
$$;
revoke execute on function public.fn_audit_log() from public, anon, authenticated;

-- The patient trigger's exclusions used to be hard-coded in the function;
-- they move to its arguments. search_name and has_phone are derived columns
-- (the second is kept in sync by a trigger on patient_contact_numbers), so
-- they were noise in the old log too.
drop trigger trg_audit_patients on patients;
create trigger trg_audit_patients
  after insert or update or delete on patients
  for each row execute function public.fn_audit_log('patient', 'balance_cents,search_name,has_phone');

-- Payments are now audited in full, so the method-change trigger only
-- guards. Its own audit_logs insert would record the same change twice.
create or replace function public.payments_method_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.method is not distinct from old.method then
    return new;
  end if;

  if old.stripe_payment_intent_id is not null then
    raise exception 'This payment was charged by card through Stripe; its method cannot be changed.'
      using errcode = 'check_violation';
  end if;
  if old.method in ('credit', 'write_off') or new.method in ('credit', 'write_off') then
    raise exception 'Account credit and write-offs are not money; a payment cannot be changed to or from one.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Clinical record. The note's text is in `snapshot` when it is written and
-- in `changes` every time it is edited, so every version can be read back.
create trigger trg_audit_visit_notes after insert or update or delete on visit_notes
  for each row execute function public.fn_audit_log('visit_note');
create trigger trg_audit_patient_files after insert or update or delete on patient_files
  for each row execute function public.fn_audit_log('patient_file', 'compressed_at,size_bytes,storage_path');
create trigger trg_audit_patient_docs after insert or update or delete on patient_docs
  for each row execute function public.fn_audit_log('patient_doc');

-- Money. invoice_line_items is left out: bonos rewrite them wholesale (6,600
-- inserts, 6,300 deletes so far), and the invoice's own total is logged.
-- facturas are left out too: factura_records is their append-only,
-- hash-chained trail, and is the one that counts.
create trigger trg_audit_payments after insert or update or delete on payments
  for each row execute function public.fn_audit_log('payment');
create trigger trg_audit_invoices after insert or update or delete on invoices
  for each row execute function public.fn_audit_log('invoice');
create trigger trg_audit_account_credits after insert or update or delete on account_credits
  for each row execute function public.fn_audit_log('account_credit');
create trigger trg_audit_package_purchases after insert or update or delete on package_purchases
  for each row execute function public.fn_audit_log('package_purchase');
create trigger trg_audit_patient_memberships after insert or update or delete on patient_memberships
  for each row execute function public.fn_audit_log('patient_membership');
create trigger trg_audit_cash_shifts after insert or update or delete on cash_shifts
  for each row execute function public.fn_audit_log('cash_shift');
create trigger trg_audit_cash_movements after insert or update or delete on cash_movements
  for each row execute function public.fn_audit_log('cash_movement');

-- Who can do what.
create trigger trg_audit_team_members after insert or update or delete on team_members
  for each row execute function public.fn_audit_log('team_member', 'dashboard_layout,theme_preference,language_preference');
create trigger trg_audit_team_member_clinics after insert or update or delete on team_member_clinics
  for each row execute function public.fn_audit_log('team_member_clinic');
create trigger trg_audit_account_roles after insert or update or delete on account_roles
  for each row execute function public.fn_audit_log('role');
create trigger trg_audit_account_invites after insert or update or delete on account_invites
  for each row execute function public.fn_audit_log('invite');
create trigger trg_audit_api_tokens after insert or update or delete on api_tokens
  for each row execute function public.fn_audit_log('api_token', 'last_used_at');
create trigger trg_audit_webhooks after insert or update or delete on webhooks
  for each row execute function public.fn_audit_log('webhook');

-- The clinic's settings and fiscal identity.
create trigger trg_audit_accounts after update on accounts
  for each row execute function public.fn_audit_log('account', 'next_invoice_number');
create trigger trg_audit_clinics after insert or update or delete on clinics
  for each row execute function public.fn_audit_log('clinic');
create trigger trg_audit_verifactu_certificates after insert or update or delete on verifactu_certificates
  for each row execute function public.fn_audit_log('verifactu_certificate');
create trigger trg_audit_verifactu_delegations after insert or update or delete on verifactu_delegations
  for each row execute function public.fn_audit_log('verifactu_delegation');
create trigger trg_audit_appointment_types after insert or update or delete on appointment_types
  for each row execute function public.fn_audit_log('appointment_type');
create trigger trg_audit_packages after insert or update or delete on packages
  for each row execute function public.fn_audit_log('package');
create trigger trg_audit_memberships after insert or update or delete on memberships
  for each row execute function public.fn_audit_log('membership');
create trigger trg_audit_services_products after insert or update or delete on services_products
  for each row execute function public.fn_audit_log('service');

-- 4. Nobody edits the trail ---------------------------------------------------
--
-- Clients already could not: audit_logs has a select policy and nothing
-- else. This makes it hold against the service role too, the way
-- factura_records does. Two writes are let through, both done by Postgres
-- itself rather than by anyone choosing to: the account-delete cascade, and
-- `on delete set null` on team_member_id when a member's row is removed
-- (actor_name keeps their name, so nothing is lost).
create or replace function public.audit_logs_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' and not exists (select 1 from public.accounts a where a.id = OLD.account_id) then
    return OLD;
  end if;
  if TG_OP = 'UPDATE'
     and NEW.team_member_id is null
     and (to_jsonb(NEW) - 'team_member_id') = (to_jsonb(OLD) - 'team_member_id') then
    return NEW;
  end if;
  raise exception '% is append-only', TG_TABLE_NAME using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function public.audit_logs_are_append_only() from public, anon, authenticated;

create trigger audit_logs_are_append_only
  before update or delete on audit_logs
  for each row execute function public.audit_logs_are_append_only();

-- 5. Who may read it ----------------------------------------------------------
--
-- The values are new, and they are the clinic's most sensitive data -- a
-- note's full text, a deleted patient's record, a role's permissions. Staff
-- keep reading what they always could (the calendar panel's history: who
-- changed this visit and when), and only those columns. Everything else is
-- read by an owner, through get_audit_log below.
revoke select on audit_logs from anon, authenticated;
grant select (id, account_id, entity_type, entity_id, action, summary, team_member_id, created_at) on audit_logs to authenticated;

drop policy "staff read audit_logs" on audit_logs;
create policy "staff read audit_logs" on audit_logs
  for select using (is_account_member(account_id) and entity_type in ('appointment', 'patient', 'payment'));

-- 6. Who looked ---------------------------------------------------------------
--
-- Reads are not something a trigger can see, so the app reports them:
-- opening a patient's record, viewing or downloading one of their files, a
-- staff PDF of their invoice or statement, and any export of patient data.
-- A client can of course choose not to report; this is the record of the
-- normal path, which is what a clinic is asked for, not proof against a
-- determined insider with the API.
--
-- patient_id and team_member_id carry no foreign key, for the same reason as
-- audit_logs.patient_id: this has to survive the patient and the member
-- being deleted. It is also why merge_patients does not move these rows --
-- an access to the duplicate record happened to that record, and it keeps
-- saying so.
create table patient_access_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid,
  team_member_id uuid,
  actor_name text,
  kind text not null check (kind in ('record_opened', 'file_viewed', 'file_downloaded', 'invoice_pdf', 'statement_pdf', 'export')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index patient_access_log_account_idx on patient_access_log (account_id, created_at desc);
create index patient_access_log_patient_idx on patient_access_log (account_id, patient_id, created_at desc) where patient_id is not null;

-- No policies: no client reads or writes it directly. Writes come through
-- log_patient_access (and the service role, for the server's PDF routes);
-- reads through get_patient_access_log, owners only.
alter table patient_access_log enable row level security;
select public.require_two_factor_on('public.patient_access_log');

create trigger patient_access_log_is_append_only
  before update or delete on patient_access_log
  for each row execute function public.audit_logs_are_append_only();

create or replace function public.log_patient_access(p_account_id uuid, p_kind text, p_patient_id uuid default null, p_detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_member_id uuid;
  v_actor_name text;
begin
  select tm.id, tm.full_name into v_team_member_id, v_actor_name
  from public.team_members tm
  where tm.account_id = p_account_id and tm.user_id = (select auth.uid()) and tm.deleted_at is null;
  if v_team_member_id is null or not public.mfa_satisfied() then
    raise exception 'Not a member of this clinic' using errcode = 'insufficient_privilege';
  end if;

  if p_kind not in ('record_opened', 'file_viewed', 'file_downloaded', 'invoice_pdf', 'statement_pdf', 'export') then
    raise exception 'Unknown access kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.account_id = p_account_id
  ) then
    raise exception 'Patient not found' using errcode = 'no_data_found';
  end if;

  -- Opening the same record repeatedly -- switching tabs inside it, coming
  -- back from the calendar -- is one visit, not twenty.
  if p_kind = 'record_opened' and exists (
    select 1 from public.patient_access_log l
    where l.account_id = p_account_id
      and l.patient_id = p_patient_id
      and l.team_member_id = v_team_member_id
      and l.kind = 'record_opened'
      and l.created_at > now() - interval '15 minutes'
  ) then
    return;
  end if;

  insert into public.patient_access_log (account_id, patient_id, team_member_id, actor_name, kind, detail)
  values (
    p_account_id, p_patient_id, v_team_member_id, v_actor_name, p_kind,
    case when pg_column_size(p_detail) <= 2000 then p_detail end
  );
end;
$$;
revoke all on function public.log_patient_access(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.log_patient_access(uuid, text, uuid, jsonb) to authenticated;

-- 7. Who signed in ------------------------------------------------------------
--
-- Recorded from GoTrue's own tables, so it holds however someone signs in:
--
--   auth.sessions     a new row is a sign-in; aal becoming aal2 is the
--                     second factor entered
--   auth.mfa_factors  a factor verified, or a verified one removed
--   auth.users        the password or email changed, a reset requested
--
-- One row per clinic the person is staff at, so each owner sees their own
-- team's sign-ins and nobody else's. Patients signing in to the app are not
-- recorded here.
--
-- What it cannot see is a FAILED password: a failed attempt writes nothing
-- to these tables. Those stay in Supabase's auth logs.
create table auth_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null,
  team_member_id uuid,
  actor_name text,
  event text not null check (event in (
    'signed_in', 'two_factor_verified', 'two_factor_enabled', 'two_factor_removed',
    'password_changed', 'password_reset_requested', 'email_changed'
  )),
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index auth_events_account_idx on auth_events (account_id, created_at desc);

alter table auth_events enable row level security;
select public.require_two_factor_on('public.auth_events');

create trigger auth_events_is_append_only
  before update or delete on auth_events
  for each row execute function public.audit_logs_are_append_only();

create or replace function public.record_auth_event(p_user_id uuid, p_event text, p_ip inet default null, p_user_agent text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.auth_events (account_id, user_id, team_member_id, actor_name, event, ip, user_agent)
  select tm.account_id, p_user_id, tm.id, tm.full_name, p_event, p_ip, left(p_user_agent, 300)
  from public.team_members tm
  where tm.user_id = p_user_id and tm.deleted_at is null;
$$;
revoke all on function public.record_auth_event(uuid, text, inet, text) from public, anon, authenticated;

-- These run inside GoTrue's own transactions. A failure here must never fail
-- a sign-in, so every one of them swallows its own error and leaves a
-- warning in the Postgres log instead.
create or replace function public.auth_sessions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if TG_OP = 'INSERT' then
      perform public.record_auth_event(NEW.user_id, 'signed_in', NEW.ip, NEW.user_agent);
    elsif NEW.aal::text = 'aal2' and OLD.aal::text is distinct from 'aal2' then
      perform public.record_auth_event(NEW.user_id, 'two_factor_verified', NEW.ip, NEW.user_agent);
    end if;
  exception when others then
    raise warning 'auth_events: could not record a session event: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.auth_sessions_audit() from public, anon, authenticated;

create or replace function public.auth_mfa_factors_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if TG_OP = 'UPDATE' and NEW.status::text = 'verified' and OLD.status::text <> 'verified' then
      perform public.record_auth_event(NEW.user_id, 'two_factor_enabled');
    elsif TG_OP = 'DELETE' and OLD.status::text = 'verified' then
      perform public.record_auth_event(OLD.user_id, 'two_factor_removed');
    end if;
  exception when others then
    raise warning 'auth_events: could not record a factor event: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.auth_mfa_factors_audit() from public, anon, authenticated;

create or replace function public.auth_users_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if NEW.encrypted_password is distinct from OLD.encrypted_password and OLD.encrypted_password is not null and OLD.encrypted_password <> '' then
      perform public.record_auth_event(NEW.id, 'password_changed');
    end if;
    if NEW.recovery_sent_at is distinct from OLD.recovery_sent_at and NEW.recovery_sent_at is not null then
      perform public.record_auth_event(NEW.id, 'password_reset_requested');
    end if;
    if NEW.email is distinct from OLD.email then
      perform public.record_auth_event(NEW.id, 'email_changed');
    end if;
  exception when others then
    raise warning 'auth_events: could not record a user event: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.auth_users_audit() from public, anon, authenticated;

drop trigger if exists quiroflow_auth_events on auth.sessions;
create trigger quiroflow_auth_events
  after insert or update of aal on auth.sessions
  for each row execute function public.auth_sessions_audit();

drop trigger if exists quiroflow_auth_events on auth.mfa_factors;
create trigger quiroflow_auth_events
  after update of status or delete on auth.mfa_factors
  for each row execute function public.auth_mfa_factors_audit();

drop trigger if exists quiroflow_auth_events on auth.users;
create trigger quiroflow_auth_events
  after update of encrypted_password, recovery_sent_at, email on auth.users
  for each row execute function public.auth_users_audit();

-- 8. Reading it back, owners only ---------------------------------------------
--
-- Owner, not a permission: who opened which patient's record, and every
-- version of a clinical note, are questions for the data controller -- the
-- same reasoning that makes VeriFactu owner-only. Two-factor is checked
-- here too, since a security definer function is not reached by the
-- restrictive policies.
--
-- Paged by time: pass the created_at of the last row seen as p_before.

-- A patient's name, including one whose row is gone: the deletion snapshot
-- in audit_logs still has it.
create or replace function public.audit_patient_name(p_account_id uuid, p_patient_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
     from public.patients p where p.id = p_patient_id and p.account_id = p_account_id),
    (select nullif(trim(coalesce(l.snapshot ->> 'first_name', '') || ' ' || coalesce(l.snapshot ->> 'last_name', '')), '')
     from public.audit_logs l
     where l.account_id = p_account_id and l.entity_type = 'patient' and l.entity_id = p_patient_id and l.snapshot is not null
     order by l.action = 'deleted' desc, l.created_at desc limit 1)
  );
$$;
revoke all on function public.audit_patient_name(uuid, uuid) from public, anon, authenticated;

create or replace function public.audit_require_owner(p_account_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_account_owner(p_account_id) or not public.mfa_satisfied() then
    raise exception 'Only an owner can read the activity log' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.audit_require_owner(uuid) from public, anon, authenticated;

create or replace function public.get_audit_log(
  p_account_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_entity_types text[] default null,
  p_patient_id uuid default null,
  p_team_member_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  entity_type text,
  entity_id uuid,
  action text,
  summary text,
  changes jsonb,
  snapshot jsonb,
  actor text,
  actor_detail text,
  actor_name text,
  team_member_id uuid,
  patient_id uuid,
  patient_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.audit_require_owner(p_account_id);
  return query
  select l.id, l.created_at, l.entity_type, l.entity_id, l.action, l.summary, l.changes, l.snapshot,
         l.actor, l.actor_detail, coalesce(tm.full_name, l.actor_name), l.team_member_id, l.patient_id,
         case when l.patient_id is not null then public.audit_patient_name(p_account_id, l.patient_id) end
  from public.audit_logs l
  left join public.team_members tm on tm.id = l.team_member_id
  where l.account_id = p_account_id
    and (p_before is null or l.created_at < p_before)
    and (p_entity_types is null or l.entity_type = any (p_entity_types))
    and (p_patient_id is null or l.patient_id = p_patient_id)
    and (p_team_member_id is null or l.team_member_id = p_team_member_id)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.get_audit_log(uuid, timestamptz, integer, text[], uuid, uuid) from public, anon;
grant execute on function public.get_audit_log(uuid, timestamptz, integer, text[], uuid, uuid) to authenticated;

create or replace function public.get_patient_access_log(
  p_account_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_patient_id uuid default null,
  p_team_member_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  kind text,
  detail jsonb,
  actor_name text,
  team_member_id uuid,
  patient_id uuid,
  patient_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.audit_require_owner(p_account_id);
  return query
  select l.id, l.created_at, l.kind, l.detail, coalesce(tm.full_name, l.actor_name), l.team_member_id, l.patient_id,
         case when l.patient_id is not null then public.audit_patient_name(p_account_id, l.patient_id) end
  from public.patient_access_log l
  left join public.team_members tm on tm.id = l.team_member_id
  where l.account_id = p_account_id
    and (p_before is null or l.created_at < p_before)
    and (p_patient_id is null or l.patient_id = p_patient_id)
    and (p_team_member_id is null or l.team_member_id = p_team_member_id)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.get_patient_access_log(uuid, timestamptz, integer, uuid, uuid) from public, anon;
grant execute on function public.get_patient_access_log(uuid, timestamptz, integer, uuid, uuid) to authenticated;

create or replace function public.get_auth_events(
  p_account_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_team_member_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  event text,
  ip text,
  user_agent text,
  actor_name text,
  team_member_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.audit_require_owner(p_account_id);
  return query
  select e.id, e.created_at, e.event, host(e.ip), e.user_agent, coalesce(tm.full_name, e.actor_name), e.team_member_id
  from public.auth_events e
  left join public.team_members tm on tm.id = e.team_member_id
  where e.account_id = p_account_id
    and (p_before is null or e.created_at < p_before)
    and (p_team_member_id is null or e.team_member_id = p_team_member_id)
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.get_auth_events(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_auth_events(uuid, timestamptz, integer, uuid) to authenticated;
