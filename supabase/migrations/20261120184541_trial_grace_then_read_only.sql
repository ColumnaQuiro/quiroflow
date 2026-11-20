-- The end of a free trial: a grace week, then read-only. Never locked out.
--
-- Until now trial-expiry-cron flipped an unpaid trial to 'locked' on the day
-- it ended, and the staff app replaced every screen with "Account locked".
-- A clinic lost its own diary mid-morning, with patients in the waiting room,
-- and could not open a clinical record it is legally obliged to keep
-- available. Of the first four trials to end that way, three stayed locked
-- and one paid: being locked out reads as "leave", not as "pay".
--
-- Now, for an account with no card on file:
--
--   * trial_ends_at -> +7 days: everything keeps working (the cron leaves the
--     row at 'trialing'), and the app says, every day, that it has ended;
--   * after that the cron sets 'locked', which no longer means "locked out":
--     every screen still opens and reads, exports still work, and what is
--     refused is CHANGING anything -- the moment the app asks for a card.
--
-- 'canceled' (a paying clinic that stopped) is treated the same way.
--
-- Read-only is enforced here, not only by the app, because most of the app
-- writes straight through PostgREST: a guard in the server routes alone
-- stops nothing. And it is a statement trigger rather than an RLS policy
-- because a policy does not reach a SECURITY DEFINER function, and much of
-- the app's real work goes through one (raise_invoice, issue_factura,
-- clock_time, merge_patients...). A trigger fires whoever is writing.

-- Which notices trial-expiry-cron has already sent this account, so a daily
-- run never sends the same one twice (server/utils/trialNotices.ts).
alter table public.subscriptions
  add column if not exists trial_notices_sent text[] not null default '{}';

-- Whether an account is read-only for unpaid billing. SECURITY DEFINER:
-- subscriptions is readable only by the account's own staff, and this is
-- also asked on behalf of a patient booking online.
create or replace function public.account_read_only(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.account_id = p_account_id
      and s.status in ('locked', 'canceled')
      and not coalesce(s.comped, false)
  );
$$;

-- Whether the person making this request is staff of a read-only account.
-- Asked about the CALLER, not about the row being written, which is what lets
-- one trigger serve every table, including the ones with no account_id of
-- their own.
--
-- auth.uid() is null for the service role (crons, webhooks, every server
-- route after its own guard) and for anon, so neither is ever refused.
-- Patients have no team_members row, so the portal and the patient app keep
-- working for them: a clinic's unpaid bill is not their problem.
create or replace function public.my_account_read_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.team_members tm
    join public.subscriptions s on s.account_id = tm.account_id
    where tm.user_id = auth.uid()
      and tm.deleted_at is null
      and s.status in ('locked', 'canceled')
      and not coalesce(s.comped, false)
  );
$$;

grant execute on function public.account_read_only(uuid) to anon, authenticated, service_role;
grant execute on function public.my_account_read_only() to anon, authenticated, service_role;

-- PT423 makes PostgREST answer 423 Locked; the message is what a call site
-- that prints error.message shows, and `detail` is the stable key the app
-- recognises (utils/supabaseFailures.ts, isAccountReadOnlyResponse).
create or replace function public.refuse_writes_while_read_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.my_account_read_only() then
    raise exception using
      errcode = 'PT423',
      message = 'Tu cuenta está en modo solo lectura. Añade un método de pago en Suscripción para seguir trabajando.',
      detail = 'account_read_only';
  end if;
  return null;
end;
$$;

-- The guard one table gets. Tables a read-only clinic must still be able to
-- write are left out by name: logs a READ writes (who opened a record),
-- read-state, a person's own preferences and devices, talking to us or to
-- colleagues, and platform bookkeeping. Everything else -- patients,
-- appointments, notes, invoices, settings -- is the clinic's work, and is
-- what a card unlocks again.
create or replace function public.read_only_guard_on(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_schema text;
  v_name text;
begin
  select n.nspname, c.relname into v_schema, v_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.oid = target;

  if v_schema is distinct from 'public' then
    return;
  end if;

  if v_name = any (array[
    -- What a read leaves behind.
    'patient_access_log', 'audit_logs', 'auth_events', 'app_opens',
    'api_request_logs', 'api_rate_limits', 'public_rate_limits', 'ai_usage',
    'inbox_reads', 'team_message_reads', 'whatsapp_conversation_reads',
    -- The person's own preferences and devices.
    'team_members', 'device_push_tokens', 'home_widget_tokens',
    'staff_push_preferences', 'wallet_registrations',
    -- Talking to colleagues, and to us.
    'team_messages', 'support_conversations', 'support_messages',
    'help_assistant_messages',
    -- Platform bookkeeping, written by the service role anyway.
    'subscriptions', 'email_daily_usage', 'email_bulk_usage',
    'platform_status', 'webhook_deliveries', 'learn_sends'
  ]) then
    return;
  end if;

  execute format('drop trigger if exists read_only_while_unpaid on %s', target);
  execute format(
    'create trigger read_only_while_unpaid before insert or update or delete on %s '
    'for each statement execute function public.refuse_writes_while_read_only()',
    target
  );
end;
$$;

revoke all on function public.read_only_guard_on(regclass) from public, anon, authenticated;

-- Every table a migration hands to require_two_factor_on gets the read-only
-- guard as well. scripts/check-rls-two-factor.mjs already insists on that
-- call for each new table, so a table added later cannot quietly stay
-- writable for a clinic that has not paid.
create or replace function public.require_two_factor_on(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create policy "two factor when required" on %s as restrictive for all to authenticated '
    'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
    target
  );
  perform public.read_only_guard_on(target);
end;
$$;

revoke all on function public.require_two_factor_on(regclass) from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    perform public.read_only_guard_on(t.tbl);
  end loop;
end;
$$;

-- Patient files and photos live in storage, where a trigger is not ours to
-- add; restrictive policies do the same job there, since the storage API
-- writes as the signed-in user.
create policy "read only while unpaid (insert)" on storage.objects
  as restrictive for insert to authenticated
  with check (not (select public.my_account_read_only()));
create policy "read only while unpaid (update)" on storage.objects
  as restrictive for update to authenticated
  using (not (select public.my_account_read_only()));
create policy "read only while unpaid (delete)" on storage.objects
  as restrictive for delete to authenticated
  using (not (select public.my_account_read_only()));

-- Online booking pauses while the account is read-only: a booking is a write
-- to the clinic's diary like any other, made by the patient on its behalf.
-- Both online paths (create_public_booking for the booking page,
-- create_patient_booking for the patient app) insert with source 'online',
-- and both pages already say this exact refusal in the patient's language
-- ("This clinic is not taking online bookings right now").
create or replace function public.online_booking_needs_active_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'online' and public.account_read_only(new.account_id) then
    raise exception 'Clinic not available for online booking';
  end if;
  return new;
end;
$$;

drop trigger if exists online_booking_needs_active_account on public.appointments;
create trigger online_booking_needs_active_account
  before insert on public.appointments
  for each row execute function public.online_booking_needs_active_account();
