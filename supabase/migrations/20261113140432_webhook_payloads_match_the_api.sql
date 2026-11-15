-- Webhook deliveries carry the fields the REST API publishes, not the whole
-- database row.
--
-- fn_dispatch_webhook_event (0021, last replaced in 0052) sent to_jsonb(row):
-- every column, to a URL outside QuiroFlow. For a patient that is the
-- clinical record -- diagnosis, red and yellow flags, notes, chief
-- complaint, pregnancy notes, the sticky note -- and for an invoice its
-- pay_token, the secret in the link that lets anyone holding it pay. The
-- public API was built the other way round (server/utils/publicApiResources.ts:
-- "select is an explicit column list, never '*'", so a column added later
-- is not published by accident); its webhooks were not, and every column
-- added to these tables since 0021 went out with them.
--
-- The lists below are the columns of each resource's `select` there, plus
-- account_id (the developer portal's example payload shows it) and, for
-- appointments, deleted_at (so an appointment.deleted can be told apart).
-- Field names and their flat shape are unchanged, so a receiver reading any
-- of these keeps working; the portal already said to treat anything else as
-- internal and not depend on it.
--
-- *.updated is now decided on those fields too: a save that changes only an
-- internal column (a clinical note, a search index, a claim timestamp) no
-- longer delivers a patient.updated that looks identical to the last one.

create or replace function public.webhook_public_fields(p_table text, p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(p_row)
  where key = any (case p_table
    when 'patients' then array[
      'id', 'account_id', 'first_name', 'last_name', 'email', 'date_of_birth', 'gender', 'status',
      'clinic_id', 'default_practitioner_id', 'address', 'city', 'postal_code', 'country',
      'national_id', 'occupation', 'emergency_contact', 'referral_source', 'referred_by_patient_id',
      'tutor_patient_id', 'is_minor', 'do_not_contact', 'preferred_language', 'reminder_channel',
      'confirmation_channel', 'marketing_channels', 'tags', 'recall_status', 'recall_priority',
      'balance_cents', 'external_reference', 'created_at']
    when 'appointments' then array[
      'id', 'account_id', 'patient_id', 'clinic_id', 'practitioner_id', 'appointment_type_id',
      'room_id', 'starts_at', 'ends_at', 'status', 'note', 'source', 'rescheduled', 'checked_in_at',
      'confirmation_status', 'confirmation_sent_at', 'reminder_sent_at', 'external_reference',
      'created_at', 'deleted_at']
    when 'invoices' then array[
      'id', 'account_id', 'invoice_number', 'patient_id', 'appointment_id', 'status', 'total_cents',
      'is_refund', 'refunds_invoice_id', 'created_at']
    else array[]::text[]
  end)
$$;

revoke execute on function public.webhook_public_fields(text, jsonb) from public, anon, authenticated;

create or replace function public.fn_dispatch_webhook_event()
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
    v_row := public.webhook_public_fields(TG_TABLE_NAME, to_jsonb(OLD));
    v_account_id := (OLD).account_id;
  else
    v_row := public.webhook_public_fields(TG_TABLE_NAME, to_jsonb(NEW));
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

  -- *.updated: skip saves that change nothing a subscriber can see.
  if TG_OP = 'UPDATE' then
    if v_row = public.webhook_public_fields(TG_TABLE_NAME, to_jsonb(OLD)) then
      return NEW;
    end if;
  end if;

  -- Nobody subscribed: nothing to build or sign. Most accounts have no
  -- webhook at all, and this runs on every patient and appointment write.
  if not exists (
    select 1 from webhooks
    where account_id = v_account_id and enabled = true and v_event_type = any(events)
  ) then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
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

revoke execute on function public.fn_dispatch_webhook_event() from public, anon, authenticated;
