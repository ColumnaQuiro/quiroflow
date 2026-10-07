-- Undo a visit that was completed by mistake.
--
-- Reception reported it on 6 Oct: Gabriela Encina's 1 Oct visit was checked
-- in, put in session, sent to checkout and drawn from her Bono 14 sesiones
-- inside three seconds, on the wrong patient. The calendar could undo each
-- flow step while the visit was still open (AppointmentPanel's "Deshacer
-- llegada" and friends), but nothing undid the step that matters most: once
-- the bono had paid for it, the visit was 'completed', the session was gone
-- from the bono and a paid receipt stood for it -- three writes in three
-- tables, and no way back short of SQL.
--
-- Doing it from the client would be three writes again, any of which RLS can
-- refuse on its own (invoices are only editable the same day under
-- financials_edit_same_day_only), leaving the session returned and the charge
-- standing, or the other way round. So it is one function, all or nothing.
--
-- SECURITY INVOKER on purpose: every table it touches is written under the
-- caller's own policies, exactly as if the panel had made the writes itself.
-- A write RLS filters away matches no row rather than raising, so each one is
-- counted and a shortfall raises -- which rolls back everything before it.
--
-- What it does:
--   - the appointment goes back to 'booked'. Its flow timestamps stay, so it
--     reopens on the step it was on ("Por cobrar" for a visit charged at the
--     desk), and the panel's existing undo buttons walk it back from there;
--   - the bono session it drew is deleted and given back to the bono;
--   - the session's charge -- the receipt carrying nothing but the bono's
--     line, utils/bonoVisitInvoice -- is voided, not deleted, so its number
--     stays accounted for. A receipt with extras on it is left alone.
--
-- What it refuses: a visit with any payment against it. Money that came in
-- may carry a factura on the VERI*FACTU chain, and taking it back is a refund
-- (Ficha > Dinero), not an undo.
create or replace function public.undo_visit(p_appointment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appt appointments%rowtype;
  v_session package_sessions%rowtype;
  v_charge_ids uuid[] := '{}';
  v_voided text[] := '{}';
  v_rows int;
begin
  select * into v_appt
  from appointments
  where id = p_appointment_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;
  if v_appt.status <> 'completed' then
    raise exception 'Only a completed visit can be undone' using errcode = 'P0001', hint = 'not_completed';
  end if;

  if exists (
    select 1
    from payments p
    join invoices i on i.id = p.invoice_id
    where i.appointment_id = p_appointment_id and i.status <> 'void'
  ) then
    raise exception 'This visit has a payment recorded; refund it from the patient''s Money tab instead'
      using errcode = 'P0001', hint = 'has_payment';
  end if;

  select * into v_session from package_sessions where appointment_id = p_appointment_id;
  if found then
    -- The session's own charge: every line on it is the bono's.
    select coalesce(array_agg(i.id), '{}') into v_charge_ids
    from invoices i
    where i.appointment_id = p_appointment_id
      and i.status <> 'void'
      and not coalesce(i.is_refund, false)
      and exists (select 1 from invoice_line_items l where l.invoice_id = i.id and l.package_purchase_id = v_session.package_purchase_id)
      and not exists (select 1 from invoice_line_items l where l.invoice_id = i.id and l.package_purchase_id is distinct from v_session.package_purchase_id);

    delete from package_sessions where id = v_session.id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You are not allowed to return a bono session' using errcode = '42501', hint = 'bono_session';
    end if;

    update package_purchases
    set sessions_used = greatest(sessions_used - 1, 0)
    where id = v_session.package_purchase_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You are not allowed to change this bono' using errcode = '42501', hint = 'bono';
    end if;

    if cardinality(v_charge_ids) > 0 then
      with voided as (
        update invoices set status = 'void' where id = any (v_charge_ids) returning invoice_number
      )
      select coalesce(array_agg(invoice_number), '{}') into v_voided from voided;
      if cardinality(v_voided) < cardinality(v_charge_ids) then
        raise exception 'You are not allowed to void this visit''s charge' using errcode = '42501', hint = 'invoice';
      end if;
    end if;
  end if;

  update appointments set status = 'booked' where id = p_appointment_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You are not allowed to change this appointment' using errcode = '42501', hint = 'appointment';
  end if;

  return jsonb_build_object(
    'session_returned', v_session.id is not null,
    'package_purchase_id', v_session.package_purchase_id,
    'voided_invoices', to_jsonb(v_voided)
  );
end;
$$;

revoke all on function public.undo_visit(uuid) from public, anon;
grant execute on function public.undo_visit(uuid) to authenticated;

comment on function public.undo_visit(uuid) is
  'Reopens a visit completed by mistake: status back to booked, its bono session returned and that session''s charge voided, in one transaction under the caller''s RLS. Refuses a visit with any payment on it -- that is a refund.';
