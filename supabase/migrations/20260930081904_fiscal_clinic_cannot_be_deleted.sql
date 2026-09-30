-- Every factura names the account's OLDEST clinic as its obligado: its legal
-- name and NIF are what fill_factura_issuer prints and what
-- record_factura_alta hashes as IDEmisorFactura (both order clinics by
-- created_at). A clinic with no appointments could be deleted, the oldest one
-- included -- and the next factura then went out under the next clinic's NIF,
-- or none, midway through a VeriFactu chain. Found in the settings QA round,
-- 30 Sep 2026.
--
-- Once the account has issued a factura, its fiscal clinic stays. Archiving
-- it is still allowed: the legal entity does not change because a location
-- closes, and its details keep appearing on facturas.
create or replace function public.guard_clinic_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The account is being deleted and is taking its clinics with it.
  if not exists (select 1 from accounts where id = old.account_id) then
    return old;
  end if;
  if exists (select 1 from appointments where clinic_id = old.id) then
    raise exception using
      errcode = '23503',
      message = 'This clinic has appointments, so it cannot be deleted. Archive it instead: its history is kept.';
  end if;
  if not exists (
    select 1 from clinics c
    where c.account_id = old.account_id and c.id <> old.id and c.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'This is the only active clinic, so it cannot be deleted.';
  end if;
  if old.id = (select c.id from clinics c where c.account_id = old.account_id order by c.created_at limit 1)
     and exists (select 1 from facturas f where f.account_id = old.account_id) then
    raise exception using
      errcode = '23503',
      message = 'Facturas are issued under this clinic''s legal name and NIF, so it cannot be deleted. Archive it instead.';
  end if;
  return old;
end;
$function$;
