-- Paying a bono did not pay the sessions already drawn from it.
--
-- A bono sold here is charged session by session: each visit drawn from it
-- raises a charge at the per-session rate, and chargeBonoVisit() marks that
-- charge paid when the family's money already covers it
-- (utils/bonoVisitCharge, 20260923165911). That decision is taken once, when
-- the session is drawn, and nothing ever revisited it. So a bono paid in two
-- halves went like this (a family bono, 480 EUR for 12 sessions at 40, 19 Nov
-- 2026):
--
--   29 Sep  240 EUR paid on the bono        covers six sessions
--           sessions 1-6 drawn              charged and marked paid
--   28 Oct  sessions 7-8 drawn              charged UNPAID -- the 240 was gone
--   03 Nov  session 9 drawn                 charged UNPAID
--   18 Nov  session 10 drawn                charged UNPAID
--   19 Nov  the other 240 EUR recorded      the bono now reads paid in full...
--
-- ...and the four charges stayed unpaid. The family's balance was +80 EUR --
-- exactly the two sessions still on the bono -- while the patient's Overview
-- said "80,00 EUR unpaid across 2 charges" and two relatives each showed
-- another 40 owed. The money had arrived; only the statuses were stale. Across
-- the live database, 14 of the 16 open bono-session charges belonged to
-- families whose balance already covered them.
--
-- So money paid towards a bono now settles the session charges it covers, by
-- the same rule a charge is judged by when it is raised: the family's pooled
-- balance (patient_family_balance_cents). Oldest first, and a charge is marked
-- paid only when the money reaches all of it -- the same oldest-first running
-- total settle_imported_invoices() uses.
--
-- What the money can reach is the family balance PLUS what is still owed on
-- the open session charges themselves. The balance is paid minus everything
-- charged (patient_live_balances does not look at status), so those charges
-- have already been taken off it once; adding back what is left on them gives
-- the money not yet spent on anything settled. Any OTHER unpaid charge in the
-- family -- a product, a walk-in visit -- stays subtracted, so its share of the
-- money is never handed to a bono session.
--
-- Only a charge that is a bono session and nothing else is touched: every line
-- names a bono. A receipt that also carries extras is not one --
-- chargeBonoVisit() keeps extras on a receipt of their own precisely because
-- they are owed in money.
--
-- Nothing is ever marked UNpaid here. Taking money back off a bono is a
-- refund or a deleted payment, which have their own paths; settling is the
-- only direction a payment arriving can move.

create or replace function public.settle_covered_bono_session_charges(p_patient_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_updated integer;
begin
  if p_patient_id is null then
    return 0;
  end if;

  -- Run as the definer, so the whole family is read whatever the caller's own
  -- RLS would show -- a family bono's money sits on the owner's record.
  v_balance := public.patient_family_balance_cents(p_patient_id);

  with family as (
    select m as patient_id from public.patient_family_members(p_patient_id) m
  ),
  open_charges as (
    select i.id,
           i.created_at,
           greatest(0, i.total_cents - coalesce((
             select sum(p.amount_cents) from payments p where p.invoice_id = i.id
           ), 0)) as remaining_cents
    from invoices i
    join family f on f.patient_id = i.patient_id
    where i.status = 'unpaid'
      and not i.is_refund
      and exists (
        select 1 from invoice_line_items li
        where li.invoice_id = i.id and li.package_purchase_id is not null
      )
      and not exists (
        select 1 from invoice_line_items li
        where li.invoice_id = i.id and li.package_purchase_id is null
      )
  ),
  running as (
    select id,
           sum(remaining_cents) over (
             order by created_at, id
             rows between unbounded preceding and current row
           ) as cumulative_cents
    from open_charges
  ),
  pool as (
    select v_balance + coalesce((select sum(remaining_cents) from open_charges), 0) as cents
  )
  update invoices i
  set status = 'paid'
  from running r, pool
  where i.id = r.id
    and r.cumulative_cents <= pool.cents
    and i.status = 'unpaid';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.settle_covered_bono_session_charges(uuid) is
  'Marks paid, oldest first, the unpaid bono-session charges in this patient''s bono-sharing family that the family''s money already covers. Run by trg_bono_payment_settles_session_charges when money is paid towards a bono.';

-- A definer that takes any patient id: never callable from the browser. The
-- trigger below is the only way in.
revoke execute on function public.settle_covered_bono_session_charges(uuid) from public, anon, authenticated;
grant execute on function public.settle_covered_bono_session_charges(uuid) to service_role;

create or replace function public.trg_bono_payment_settles_session_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.settle_covered_bono_session_charges(new.patient_id);
  return null;
end;
$$;

revoke execute on function public.trg_bono_payment_settles_session_charges() from public, anon, authenticated;

-- Money counts towards a bono when it is linked to one and was not taken on
-- account (utils/bonoOwed): the same test here. That covers a payment taken
-- on the bono's card, one taken at its sale, a gift voucher redeemed for it,
-- an existing payment linked to it afterwards, and a visit's payment moved
-- onto it -- web, app or server, since all of them end in this table.
drop trigger if exists trg_bono_payment_settles_session_charges on public.payments;
create trigger trg_bono_payment_settles_session_charges
  after insert or update of amount_cents, package_purchase_id, purpose, patient_id on public.payments
  for each row
  when (new.package_purchase_id is not null and new.patient_id is not null and new.purpose is distinct from 'on_account')
  execute function public.trg_bono_payment_settles_session_charges();

-- The charges already left behind. Same rule, once per family that has one.
select public.settle_covered_bono_session_charges(x.patient_id)
from (
  select distinct i.patient_id
  from invoices i
  join invoice_line_items li on li.invoice_id = i.id
  where i.status = 'unpaid'
    and not i.is_refund
    and li.package_purchase_id is not null
) x;
