-- Developer webhooks: an account can register endpoint(s) that receive an
-- HMAC-signed POST whenever a subscribed event happens (new patient,
-- appointment created/updated, invoice paid...). Delivery is fire-and-forget
-- via pg_net (Supabase's async HTTP extension) called directly from a
-- trigger, so no extra worker process is needed. webhook_deliveries is a
-- read-only log so staff/developers can see what was sent while building an
-- integration; it records pg_net's request_id but doesn't reconcile the
-- async response back onto the row (that would need a separate poller
-- against net._http_response) -- fine for a first version, worth adding
-- later if retries/failure alerts become necessary.

-- pg_net always installs its objects into its own `net` schema and isn't
-- relocatable (ALTER EXTENSION ... SET SCHEMA errors), so the "extension in
-- public" advisor warning this triggers is expected and can't be resolved.
create extension if not exists pg_net;

create table webhooks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  url text not null,
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  events text[] not null default '{}',
  enabled boolean not null default true,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  request_id bigint,
  created_at timestamptz not null default now()
);

alter table webhooks enable row level security;
alter table webhook_deliveries enable row level security;

create policy "staff manage webhooks" on webhooks
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "staff read webhook_deliveries" on webhook_deliveries
  for select using (is_account_member(account_id));

create index webhook_deliveries_webhook_id_idx on webhook_deliveries (webhook_id, created_at desc);

-- ---------------------------------------------------------------------
-- Generic dispatch trigger: fires the event named in TG_ARGV[0] to every
-- enabled webhook on the row's account that subscribed to it.
-- ---------------------------------------------------------------------

create or replace function fn_dispatch_webhook_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event_type text := TG_ARGV[0];
  v_account_id uuid;
  v_row jsonb;
  v_payload jsonb;
  v_webhook record;
  v_signature text;
  v_request_id bigint;
begin
  if TG_OP = 'DELETE' then
    v_row := to_jsonb(OLD);
    v_account_id := (OLD).account_id;
  else
    v_row := to_jsonb(NEW);
    v_account_id := (NEW).account_id;
  end if;

  -- invoice.paid only fires on the transition into 'paid', not every edit.
  if v_event_type = 'invoice.paid' then
    if TG_OP <> 'UPDATE' then
      return NEW;
    end if;
    if NEW.status <> 'paid' or OLD.status = 'paid' then
      return NEW;
    end if;
  end if;

  -- *.updated: skip no-op saves (e.g. a resave with nothing changed) so
  -- subscribers don't get empty noise.
  if TG_OP = 'UPDATE' then
    if v_row = to_jsonb(OLD) then
      return NEW;
    end if;
  end if;

  v_payload := jsonb_build_object('event', v_event_type, 'created_at', now(), 'data', v_row);

  for v_webhook in
    select * from webhooks
    where account_id = v_account_id and enabled = true and v_event_type = any(events)
  loop
    v_signature := encode(hmac(v_payload::text, v_webhook.secret, 'sha256'), 'hex');
    v_request_id := net.http_post(
      url := v_webhook.url,
      body := v_payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-QuiroFlow-Event', v_event_type,
        'X-QuiroFlow-Signature', v_signature
      )
    );
    insert into webhook_deliveries (account_id, webhook_id, event_type, payload, request_id)
    values (v_account_id, v_webhook.id, v_event_type, v_payload, v_request_id);
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

create trigger trg_webhook_patient_created
  after insert on patients
  for each row execute function fn_dispatch_webhook_event('patient.created');

create trigger trg_webhook_patient_updated
  after update on patients
  for each row execute function fn_dispatch_webhook_event('patient.updated');

create trigger trg_webhook_patient_deleted
  after delete on patients
  for each row execute function fn_dispatch_webhook_event('patient.deleted');

create trigger trg_webhook_appointment_created
  after insert on appointments
  for each row execute function fn_dispatch_webhook_event('appointment.created');

create trigger trg_webhook_appointment_updated
  after update on appointments
  for each row execute function fn_dispatch_webhook_event('appointment.updated');

create trigger trg_webhook_invoice_paid
  after update on invoices
  for each row execute function fn_dispatch_webhook_event('invoice.paid');

-- Trigger-return-type functions can't be invoked directly via SQL (Postgres
-- rejects it), so this is defense-in-depth, not a functional requirement.
revoke execute on function fn_dispatch_webhook_event() from anon, authenticated;
