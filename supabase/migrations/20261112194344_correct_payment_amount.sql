-- Correcting the amount of a payment recorded wrongly, with a rectificativa.
--
-- A payment typed in as 50 EUR that was really 40 had no fix of its own. The
-- desk's only route was three steps: remove the payment, annul the factura
-- it left behind, take the payment again -- and the second step was easy to
-- skip, leaving a factura for money that never came in.
--
-- correct_payment_amount() does it in one transaction: the payment takes its
-- right amount, and the factura issued for it is corrected by a rectificativa
-- for the DIFFERENCE (R1, TipoRectificativa 'I', as every rectificativa
-- here). The original factura is never touched. Its alta is already in the
-- chain, and possibly at the AEAT; what corrects it is a second document
-- that names it, which is what RD 1619/2012 art. 15 asks for and what a
-- sistema informático de facturación has to do (RD 1007/2023): no record is
-- altered or removed, every correction leaves its own.
--
-- The difference can go either way. 50 recorded, 40 taken: R-... for -10.
-- 40 recorded, 50 taken: R-... for +10. A positive rectificativa por
-- diferencias is as valid as a negative one; amount_cents carries the sign.
--
-- What it does NOT do is reduce what a factura documents below the money
-- the payment records. The amount of a payment with a factura can now only
-- change through here (guard below), so the payment and the fiscal record
-- move together or not at all -- a payment cannot be edited down while its
-- factura, or the lack of one, says something else.

-- ---------------------------------------------------------------------
-- The guard: a payment's amount changes only with its factura.
--
-- Staff can update payments (the method, since 20260929094512), and the
-- write policy does not look at columns. Without this, a REST call could
-- change the amount of a payment whose factura then documents a different
-- sum, with nothing in the series to say so. Payments with no factura (the
-- PracticeHub import, which was deliberately not retrofitted) are left
-- alone: there is no fiscal record for them to drift from.
create or replace function public.payments_amount_change()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.amount_cents is not distinct from old.amount_cents then
    return new;
  end if;
  if coalesce(current_setting('quiroflow.correcting_payment', true), '') = 'on' then
    return new;
  end if;
  if exists (
    select 1 from facturas f
    where f.payment_id = old.id and f.kind <> 'rectificativa' and f.annulled_at is null
  ) then
    raise exception 'A factura was issued for this payment, so its amount can only be corrected through correct_payment_amount(), which issues the rectificativa.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.payments_amount_change() from public, anon, authenticated;

drop trigger if exists payments_amount_change on payments;
create trigger payments_amount_change
  before update of amount_cents on payments
  for each row execute function public.payments_amount_change();

-- ---------------------------------------------------------------------
-- Euros the way a Spanish document writes them: 1274,50 €. Ungrouped on
-- purpose (RAE/CLDR for four digits), and the same as the app shows.
create or replace function public.factura_euros(p_cents integer)
returns text
language sql
immutable
as $$
  select replace(to_char(p_cents / 100.0, 'FM999999990.00'), '.', ',') || ' €';
$$;

-- ---------------------------------------------------------------------
-- The correction itself.
--
-- Which payments: money taken at the desk against a receipt -- cash, card
-- on the terminal, Bizum, transfer. Not:
--   * a Stripe or GoCardless charge: the processor's amount is a fact, and a
--     wrong one is a refund;
--   * 'credit' or 'write_off': not money (see 20260929094512);
--   * a refund's own negative payment, or a payment something has already
--     been refunded against: the refund's rectificativa already corrects its
--     factura, and a second correction on top is a sum nobody can follow;
--   * a payment toward a bono, or a top-up of account credit: those keep
--     their own books (package_purchases.owed_cents, account_credits) that a
--     changed amount would leave behind. Remove and re-record those.
--
-- Returns the rectificativa's number, or null when the payment had no
-- factura and only its amount changed.
create or replace function public.correct_payment_amount(
  p_payment_id uuid,
  p_amount_cents integer,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  p payments;
  f facturas;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_diff integer;
  v_documented integer;
  v_base integer;
  v_number text;
  v_invoice invoices;
  v_paid integer;
begin
  select * into p from payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;

  -- Security definer: the caller's rights are checked here, the same pair
  -- removing a payment and annulling a factura need. The service role (no
  -- auth.uid()) passes.
  if auth.uid() is not null then
    if not is_account_member(p.account_id) then
      raise exception 'not a member of account %', p.account_id using errcode = '42501';
    end if;
    if not mfa_satisfied() then
      raise exception 'Two-factor verification is required' using errcode = '42501';
    end if;
    if not (has_permission(p.account_id, 'financials_edit_all') and has_permission(p.account_id, 'payments_allocate')) then
      raise exception 'You do not have permission to correct payments' using errcode = '42501';
    end if;
  end if;

  if v_reason is null then
    raise exception 'Say why the amount is being corrected; the reason is printed on the rectificativa.' using errcode = 'check_violation';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'The corrected amount must be more than zero. A payment recorded in error is removed, not corrected to nothing.' using errcode = 'check_violation';
  end if;
  if p_amount_cents = p.amount_cents then
    raise exception 'The amount is unchanged.' using errcode = 'check_violation';
  end if;
  if p.amount_cents <= 0 then
    raise exception 'A refund cannot be corrected; record another refund instead.' using errcode = 'check_violation';
  end if;
  if p.stripe_payment_intent_id is not null or p.gocardless_payment_id is not null then
    raise exception 'This payment was charged through a payment processor; its amount is what was charged. Record a refund for money that went back.' using errcode = 'check_violation';
  end if;
  if p.method in ('credit', 'write_off') then
    raise exception 'Account credit and write-offs are not money; their amount cannot be corrected.' using errcode = 'check_violation';
  end if;
  if p.invoice_id is null or p.package_purchase_id is not null
     or exists (select 1 from account_credits c where c.payment_id = p.id) then
    raise exception 'Only a payment against a receipt can be corrected. For a bono payment or a top-up, remove it and record it again.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from invoices i where i.refunds_payment_id = p.id) then
    raise exception 'Money has already been refunded against this payment; correct it with another refund.' using errcode = 'check_violation';
  end if;

  v_diff := p_amount_cents - p.amount_cents;

  select * into f from facturas
  where payment_id = p.id and kind <> 'rectificativa'
  for update;

  if found then
    if f.annulled_at is not null then
      raise exception 'Factura % is annulled; it no longer documents this payment.', f.number using errcode = 'check_violation';
    end if;

    -- What the factura documents today, its earlier corrections included.
    -- It has to equal the payment: that is what every correction through
    -- here preserves, and anything else means a refund or a hand-issued
    -- rectificativa already changed it, which this cannot reason about.
    select f.amount_cents + coalesce(sum(r.amount_cents), 0)
      into v_documented
    from facturas r
    where r.rectifies_factura_id = f.id and r.kind = 'rectificativa';
    if v_documented <> p.amount_cents then
      raise exception 'Factura % documents % but the payment is %; it has been corrected another way already.',
        f.number, factura_euros(v_documented), factura_euros(p.amount_cents)
        using errcode = 'check_violation';
    end if;

    -- The original's tax treatment, carried to the difference: a correction
    -- of an exempt visit is exempt, one of a product sold at 21 % is at 21 %.
    -- Same arithmetic as utils/facturaTax.ts (round the base, cuota by
    -- subtraction), on the absolute amount and then signed, as
    -- issueRectificativa does -- so a -10 and a +10 split identically.
    if coalesce(f.tax_rate_bp, 0) > 0 and f.tax_exemption_code is null then
      v_base := round((abs(v_diff)::numeric * 10000) / (10000 + f.tax_rate_bp))::integer;
    else
      v_base := abs(v_diff);
    end if;

    -- Addressed like the original: fill_factura_recipient copies a tutor
    -- from the factura it rectifies.
    select i.number into v_number
    from issue_factura(
      f.account_id,
      f.patient_id,
      null,
      'rectificativa',
      'Rectificación de ' || f.number || ' — importe corregido de '
        || factura_euros(p.amount_cents) || ' a ' || factura_euros(p_amount_cents) || ': ' || v_reason,
      v_diff,
      sign(v_diff)::integer * v_base,
      case when f.tax_exemption_code is null then coalesce(f.tax_rate_bp, 0) else 0 end,
      sign(v_diff)::integer * (abs(v_diff) - v_base),
      f.tax_exemption_code,
      f.id
    ) i;
  end if;

  perform set_config('quiroflow.correcting_payment', 'on', true);
  update payments set amount_cents = p_amount_cents where id = p.id;
  perform set_config('quiroflow.correcting_payment', 'off', true);

  -- The receipt follows what is now paid on it, as removing a payment does.
  select * into v_invoice from invoices where id = p.invoice_id;
  if found and v_invoice.status <> 'void' then
    select coalesce(sum(amount_cents), 0) into v_paid from payments where invoice_id = v_invoice.id;
    update invoices
    set status = case when v_paid >= v_invoice.total_cents then 'paid' else 'unpaid' end
    where id = v_invoice.id
      and status is distinct from case when v_paid >= v_invoice.total_cents then 'paid' else 'unpaid' end;
  end if;

  return v_number;
end;
$$;

revoke all on function public.correct_payment_amount(uuid, integer, text) from public, anon;
grant execute on function public.correct_payment_amount(uuid, integer, text) to authenticated, service_role;

comment on function public.correct_payment_amount(uuid, integer, text) is
  'Corrects the amount of a payment recorded wrongly and, when a factura was issued for it, issues a rectificativa for the difference naming that factura. Returns the rectificativa number, or null when there was no factura.';

comment on column facturas.amount_cents is
  'Signed. Negative on a rectificativa for money going back or an amount recorded too high; positive on one correcting an amount recorded too low.';
