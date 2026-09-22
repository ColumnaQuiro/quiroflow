-- A bono sold in QuiroFlow was charged twice.
--
-- Selling one raised an invoice for its full price, and then every visit
-- drawn from it raised its own charge as well. Alonso Varela: 528 EUR for
-- the bono, 44 EUR for the visit he took from it. Run that bono to the end
-- and it is 528 + 12 x 44 = 1,056 EUR charged for 528 EUR of sessions.
--
-- The 518 bonos migrated from PracticeHub never had this problem. Phase 5
-- removed their sale invoices, so the money sits on the account and each
-- visit's charge draws it down -- which is how PracticeHub itself records a
-- bono, and what all 7,018 imported visits already look like. The native sale
-- path simply never stopped raising the up-front invoice.
--
-- So the invoice goes, and owed_cents carries what the bono still costs. That
-- gives one model instead of two, and makes the rule the clinic states hold
-- everywhere: a payment gets a factura, a visit gets a recibo, and nothing is
-- charged twice.

comment on column package_purchases.owed_cents is
  'What is still owed on this bono, before payments against it. For a bono migrated from PracticeHub this is PracticeHub''s own outstanding figure, already net of what was paid over there. For a bono sold here it is the full price, and every payment linked to the purchase comes off it. See utils/bonoOwed.ts, which is the one place that arithmetic lives.';

-- Existing native sales: exactly one on the live account (Alonso Varela's
-- Bono 12 sesiones), since the invoice-per-bono flow is recent. Its payments
-- move onto the purchase, the credit row stops pointing at a charge that is
-- about to disappear, and the invoice itself goes -- it was never a real debt
-- on top of the visits.
do $$
declare
  v_purchase record;
  v_moved int := 0;
begin
  for v_purchase in
    select pp.id, pp.invoice_id, pp.price_cents
    from package_purchases pp
    where pp.external_reference is null
      and pp.invoice_id is not null
  loop
    -- Relink first: payments cascade when an invoice is deleted, so dropping
    -- the invoice with money still pointing at it would destroy the record of
    -- that money.
    update payments
       set package_purchase_id = v_purchase.id,
           invoice_id = null
     where invoice_id = v_purchase.invoice_id;

    update account_credits
       set invoice_id = null
     where invoice_id = v_purchase.invoice_id;

    update package_purchases
       set owed_cents = v_purchase.price_cents,
           invoice_id = null
     where id = v_purchase.id;

    delete from invoice_line_items where invoice_id = v_purchase.invoice_id;
    delete from invoices where id = v_purchase.invoice_id;
    v_moved := v_moved + 1;
  end loop;

  raise notice 'bono sale invoices retired: %', v_moved;
end $$;

-- Nothing may be left half-converted: a native bono pointing at an invoice,
-- or a payment still tied to one that no longer exists.
do $$
declare v_left int;
begin
  select count(*) into v_left
    from package_purchases
   where external_reference is null and invoice_id is not null;
  assert v_left = 0, format('%s native bonos still point at a sale invoice', v_left);

  select count(*) into v_left
    from payments p
    left join invoices i on i.id = p.invoice_id
   where p.invoice_id is not null and i.id is null;
  assert v_left = 0, format('%s payments point at an invoice that is gone', v_left);
end $$;
