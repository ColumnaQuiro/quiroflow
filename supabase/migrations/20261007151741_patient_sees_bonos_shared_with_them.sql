-- A family bono, seen by the family member it is shared with.
--
-- package_purchase_shares (0076) has only a staff policy, and the bono itself
-- belongs to someone else, whose package_purchases and patients rows a
-- patient cannot read. So for the patient it was shared with, the share read
-- came back empty without an error: "Sesiones 0" and "No tienes ningún bono
-- activo" in the app and the portal while the clinic drew their visits from
-- it. Staff see it, through the table, as they always have.
--
-- Opening those tables to family would expose the owner's whole record. This
-- returns only what the screens show -- the bono's counters and the owner's
-- name -- and only to the patient themselves.
create or replace function public.get_my_shared_packages(p_patient_id uuid)
returns table (
  id uuid,
  package_name text,
  sessions_total integer,
  sessions_used integer,
  price_cents integer,
  is_closed boolean,
  owner_first_name text,
  owner_last_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select pp.id, pp.package_name, pp.sessions_total, pp.sessions_used, pp.price_cents, pp.is_closed,
         owner.first_name, owner.last_name
  from public.package_purchase_shares s
  join public.package_purchases pp on pp.id = s.package_purchase_id and pp.account_id = s.account_id
  join public.patients owner on owner.id = pp.patient_id
  where s.patient_id = p_patient_id
    and exists (select 1 from public.patients me where me.id = p_patient_id and me.user_id = auth.uid())
    and public.mfa_satisfied()
$$;

revoke all on function public.get_my_shared_packages(uuid) from public, anon;
grant execute on function public.get_my_shared_packages(uuid) to authenticated;
