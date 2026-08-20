-- Front-desk check-in: when a patient physically arrives, staff mark the
-- appointment as checked in. Surfaced on Calendar and My Day, and fires a
-- dedicated appointment.checked_in webhook so accounts can wire up their
-- own "patient has arrived" integrations (e.g. a waiting-room display).
alter table appointments add column checked_in_at timestamptz;

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

  -- appointment.checked_in only fires on the null -> not-null transition.
  if v_event_type = 'appointment.checked_in' then
    if TG_OP <> 'UPDATE' then
      return NEW;
    end if;
    if NEW.checked_in_at is null or OLD.checked_in_at is not null then
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

create trigger trg_webhook_appointment_checked_in
  after update on appointments
  for each row execute function fn_dispatch_webhook_event('appointment.checked_in');
