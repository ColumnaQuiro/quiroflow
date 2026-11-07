-- A one-line receipt, and the payment that settles it when there is one,
-- written in ONE transaction: all of it or none of it.
--
-- Three places raised a receipt from separate requests and checked only the
-- first of them:
--
--   - "Collect payment now" on the calendar's new-appointment panel numbered
--     an invoice, inserted it as PAID, then its line, then the payment (or,
--     for credit, a payment and the negative account_credits row), with no
--     error read after the first. A payment the database refused left an
--     invoice saying "paid" with nothing settling it -- money the patient owes
--     that no list will ever show as owed -- and the panel closed as if the
--     visit had been paid for.
--   - The scheduling-policy fee on a reschedule (pages/calendar.vue) and the
--     cancellation / missed-appointment fee (/api/appointments/cancellation-fee)
--     raised the invoice and then the line, ignoring the line's error: a
--     receipt with a total and nothing on it.
--
-- Here a failure anywhere rolls back everything before it, including the
-- invoice number: next_invoice_number() is a counter row updated in this same
-- transaction, so a refused receipt gives its number back rather than leaving
-- a hole in the INV- series.
--
-- The factura is deliberately NOT issued here. It is the caller's, once, for
-- the payment_id this returns, through useFacturas().issueFactura -- the one
-- path every screen uses so that every factura carries the account's tax
-- breakdown. That function never rolls a payment back: money the clinic took
-- must be recorded whether or not its document could be issued, and a missing
-- factura is reported and can be issued again. A credit payment gets no
-- factura at all -- that money was documented when the credit was paid in.
--
-- Security invoker, as charge_visit_to_third_party is: every write below is
-- the caller's own, under the staff policies on invoices, invoice_line_items,
-- payments and account_credits, including the restrictive two-factor ones. So
-- this grants nothing a role could not already do from the browser; it only
-- makes the writes stand or fall together. Ids are made here rather than read
-- back with RETURNING, so a role that may write a row it cannot then select
-- is not refused for the read.
--
-- All three callers use the signed-in person's own client (the
-- cancellation-fee route included: requireTeamMember hands back a
-- user-scoped one). Granted to the service role as well, for a server job;
-- there auth.uid() is null, next_invoice_number() treats that as a trusted
-- server caller, and created_by is simply left null.
create or replace function public.raise_invoice(
  p_patient_id uuid,
  p_description text,
  p_amount_cents integer,
  p_appointment_id uuid default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_account uuid;
  v_number text;
  v_invoice uuid := gen_random_uuid();
  v_payment uuid;
  v_member uuid;
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'The amount must be more than zero' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'The receipt needs a description' using errcode = 'check_violation';
  end if;
  if p_payment_method is not null and btrim(p_payment_method) = '' then
    raise exception 'Choose how it is paid' using errcode = 'check_violation';
  end if;

  select account_id into v_account from patients where id = p_patient_id;
  if v_account is null then
    raise exception 'Patient not found' using errcode = 'no_data_found';
  end if;
  if p_appointment_id is not null
     and not exists (select 1 from appointments where id = p_appointment_id and patient_id = p_patient_id and account_id = v_account) then
    raise exception 'That appointment is not this patient''s' using errcode = 'no_data_found';
  end if;

  v_number := next_invoice_number(v_account);

  -- Raised paid only together with the payment that pays it, in this same
  -- transaction -- never paid on its own.
  insert into invoices (id, account_id, patient_id, appointment_id, invoice_number, status, total_cents)
  values (v_invoice, v_account, p_patient_id, p_appointment_id, v_number,
          case when p_payment_method is null then 'unpaid' else 'paid' end, p_amount_cents);

  insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
  values (v_account, v_invoice, btrim(p_description), 1, p_amount_cents);

  if p_payment_method is not null then
    v_member := current_team_member_id(v_account);
    v_payment := gen_random_uuid();
    -- purpose is what a factura describes; a credit payment has none.
    insert into payments (id, account_id, patient_id, invoice_id, amount_cents, method, purpose, created_by)
    values (v_payment, v_account, p_patient_id, v_invoice, p_amount_cents, p_payment_method,
            case when p_payment_method = 'credit' then null else 'visit' end, v_member);

    -- Spending credit is two rows: the payment that settles the receipt and
    -- the negative entry that takes the credit off the patient. Either alone
    -- is wrong -- a settled receipt with credit untouched, or credit gone with
    -- nothing settled.
    if p_payment_method = 'credit' then
      insert into account_credits (account_id, patient_id, amount_cents, reason, invoice_id, created_by)
      values (v_account, p_patient_id, -p_amount_cents, 'Applied to invoice ' || v_number, v_invoice, v_member);
    end if;
  end if;

  return jsonb_build_object('invoice_id', v_invoice, 'invoice_number', v_number, 'payment_id', v_payment);
end;
$$;
revoke all on function public.raise_invoice(uuid, text, integer, uuid, text) from public, anon;
grant execute on function public.raise_invoice(uuid, text, integer, uuid, text) to authenticated, service_role;
