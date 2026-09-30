-- Settings > Invoicing's "next receipt number" saved accounts.next_invoice_number,
-- which nothing read: receipts are numbered by next_invoice_number() from
-- invoice_number_sequences (0168), series INV-. Setting 5000 and saving
-- showed "Saved" and the next receipt was still INV-<old + 1>.
--
-- These two do for receipts what get/set_factura_numbering do for facturas:
-- read the real counter, and move it forward only. Back would hand out a
-- number already on a receipt; forward leaves a gap, which is what continuing
-- another system's series looks like. accounts.next_invoice_number stays (the
-- live code still selects it until this release ships) and is no longer
-- written by the page.

create or replace function public.get_receipt_numbering(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and not (is_account_member(p_account_id) and has_permission(p_account_id, 'billing_config')) then
    raise exception 'Not permitted';
  end if;

  return jsonb_build_object(
    'prefix', 'INV-',
    'next_receipt', coalesce((select s.next_number from invoice_number_sequences s
                              where s.account_id = p_account_id and s.prefix = 'INV-'), 1)
  );
end;
$function$;

create or replace function public.set_receipt_numbering(p_account_id uuid, p_next_receipt bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current bigint;
begin
  if auth.uid() is not null
     and not (is_account_member(p_account_id) and has_permission(p_account_id, 'billing_config')) then
    raise exception 'Not permitted';
  end if;

  if p_next_receipt is null or p_next_receipt < 1 or p_next_receipt > 99999999 then
    raise exception 'The next receipt number must be between 1 and 99999999'
      using errcode = '22023';
  end if;

  -- Serialises with next_invoice_number(): both go through the same row.
  select s.next_number into v_current
  from invoice_number_sequences s
  where s.account_id = p_account_id and s.prefix = 'INV-'
  for update;

  if p_next_receipt < coalesce(v_current, 1) then
    raise exception 'The next receipt number can only move forward: % is already in use (next is %)',
      p_next_receipt, v_current
      using errcode = '22023';
  end if;

  insert into invoice_number_sequences (account_id, prefix, next_number)
  values (p_account_id, 'INV-', p_next_receipt)
  on conflict (account_id, prefix) do update
    set next_number = excluded.next_number,
        updated_at = now();

  return get_receipt_numbering(p_account_id);
end;
$function$;

revoke all on function public.get_receipt_numbering(uuid) from public, anon;
revoke all on function public.set_receipt_numbering(uuid, bigint) from public, anon;
grant execute on function public.get_receipt_numbering(uuid) to authenticated;
grant execute on function public.set_receipt_numbering(uuid, bigint) to authenticated;
