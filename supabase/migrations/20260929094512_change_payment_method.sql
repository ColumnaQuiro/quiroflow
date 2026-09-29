-- A payment's method can be corrected in place (Billing -> ledger -> the
-- payment's row -> "Change method"), for the payment taken as cash that was
-- really card. Until now the only fix was to remove the payment and take it
-- again, which reopened the receipt in between, re-dated the money to the day
-- of the correction, and left a factura issued for it flagged as matching no
-- payment.
--
-- Two things belong in the database rather than the button.
--
-- 1. What may not change. A payment charged through Stripe was card: the
--    method is a fact about the charge, not a choice someone made. 'credit'
--    spends a patient's account balance and 'write_off' settles a receipt
--    without money (see composables/usePaymentMethods.ts); turning either into
--    money, or money into either, would put cash in the drawer that never
--    arrived or take out cash that did. The staff write policy on payments
--    already allows the update itself, so this is the only place to stop it.
--
-- 2. A trace. Moving an amount from cash to card changes what the cash shift
--    says should be in the drawer, and payments had no audit trail at all.
--    Each change is written to audit_logs as a 'payment' entry, with who made
--    it, the same way appointment and patient changes already are.
alter table audit_logs drop constraint audit_logs_entity_type_check;
alter table audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('appointment', 'patient', 'payment'));

create or replace function public.payments_method_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_member_id uuid;
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

  select tm.id into v_team_member_id
  from team_members tm
  where tm.account_id = new.account_id and tm.user_id = auth.uid();

  insert into audit_logs (account_id, entity_type, entity_id, action, summary, team_member_id)
  values (new.account_id, 'payment', new.id, 'updated', 'Method changed from ' || old.method || ' to ' || new.method, v_team_member_id);

  return new;
end;
$$;

-- Not an RPC; only the trigger below calls it.
revoke all on function public.payments_method_change() from public, anon, authenticated;

drop trigger if exists payments_method_change on payments;
create trigger payments_method_change
  before update of method on payments
  for each row execute function public.payments_method_change();
