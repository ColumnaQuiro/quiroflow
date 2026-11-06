-- settle_imported_invoices() timed out on the first large clinic.
--
-- A new clinic imported its PracticeHub ledger (10,251 invoices, 3,682
-- payments) and the last step failed with "canceling statement due to
-- statement timeout". The function had to mark 9,698 invoices paid in one
-- UPDATE, and every updated row fires trg_audit_invoices. Run as postgres it
-- took 5.9 s; called from the browser it runs under `authenticated`, whose
-- statement_timeout is 8 s, and it did not finish. The whole UPDATE rolled
-- back, so every imported invoice stayed unpaid and every patient looked as
-- if they owed their entire history. Choosing which invoices are paid is fast
-- (~30 ms). The time goes on writing the rows.
--
-- So it now takes an optional p_limit and changes at most that many invoices
-- per call. The importer calls it until a call changes fewer than the limit.
-- Batching is safe because the decision does not depend on any invoice's
-- current status: each call recomputes the same running totals and only
-- writes rows whose status still differs, so the next call picks up where
-- the last one stopped, and running it again changes nothing.
--
-- p_limit defaults to null, meaning no limit, so a call that passes only
-- p_account_id behaves exactly as before. That covers the importer that is
-- live now and the service-role caller in the Cypress tasks. The one-argument
-- version is dropped rather than overloaded, because with both in place a
-- one-argument call would be ambiguous.
drop function if exists public.settle_imported_invoices(uuid);

create function public.settle_imported_invoices(p_account_id uuid, p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is not null and not has_permission(p_account_id, 'data_admin') then
    raise exception 'Not permitted';
  end if;

  with recursive
  reach (patient_id, member) as (
    select p.id, p.id from patients p where p.account_id = p_account_id
    union
    select r.patient_id, e.b
    from reach r
    join package_share_edges e on e.a = r.member and e.account_id = p_account_id
  ),
  -- One stable id per component. Every member reaches the same set, so the
  -- minimum is the same for all of them; text because uuid has no min().
  household as (
    select patient_id, min(member::text) as gid
    from reach
    group by patient_id
  ),
  paid as (
    select h.gid, sum(pay.amount_cents) as paid_cents
    from payments pay
    join household h on h.patient_id = pay.patient_id
    where pay.account_id = p_account_id
      and pay.external_reference like 'phpay-%'
    group by h.gid
  ),
  running as (
    select i.id,
           i.status as current_status,
           h.gid,
           sum(i.total_cents) over (
             partition by h.gid
             order by i.created_at, i.id
             rows between unbounded preceding and current row
           ) as cumulative_cents
    from invoices i
    join household h on h.patient_id = i.patient_id
    where i.account_id = p_account_id
      and i.external_reference like 'phinv-%'
      and i.status <> 'void'
  ),
  decided as (
    select r.id,
           case when coalesce(p.paid_cents, 0) >= r.cumulative_cents then 'paid' else 'unpaid' end as status
    from running r
    left join paid p on p.gid = r.gid
  ),
  -- Only the rows that would change, and at most p_limit of them. The
  -- running totals above are computed over every invoice regardless, so a
  -- batch never changes the answer for the rows left for the next call.
  pending as (
    select d.id, d.status
    from decided d
    join running r on r.id = d.id
    where r.current_status <> d.status
    order by d.id
    limit p_limit
  )
  update invoices i
  set status = pd.status
  from pending pd
  where i.id = pd.id and i.status <> pd.status and i.status <> 'void';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Same grants as before (20261017163212): not anon, which a definer with a
-- guard that lets a null auth.uid() through must never be.
revoke execute on function public.settle_imported_invoices(uuid, integer) from public, anon;
grant execute on function public.settle_imported_invoices(uuid, integer) to authenticated, service_role;
