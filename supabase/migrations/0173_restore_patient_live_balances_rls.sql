-- Reconciles two security fixes that were applied directly to production with
-- the migrations that are supposed to describe it. Until this lands, every
-- local stack and every CI Cypress shard rebuilds from migrations and gets the
-- vulnerable shapes back, and a restore of production would silently undo both.
--
-- ---------------------------------------------------------------------------
-- 1. patient_live_balances lost its security_invoker and leaked every clinic
-- ---------------------------------------------------------------------------
--
-- 0094 created this view `with (security_invoker = true)` on purpose, so that
-- RLS on the underlying tables -- not the view owner's rights -- governs who
-- sees which row. Production had it as SECURITY DEFINER instead, and no
-- migration in this directory ever redefined it: someone ran a
-- `create or replace view` straight against the database without repeating the
-- WITH clause, which resets the option to the default. Nothing detected the
-- drift.
--
-- The consequence, measured on production before the fix: the `anon` role --
-- the key that ships inside the browser bundle, readable by anyone who opens
-- the app -- selected 1,555 rows spanning all 3 accounts. The `patients` table
-- itself correctly returned 0 rows for the same role; the view simply walked
-- around it. Each row is patient_id, account_id and balance_cents: who owes
-- money, to which clinic, how much.
--
-- Restoring security_invoker also fixes a subtler leak *inside* an account
-- that the first hotfix did not. A `WHERE is_account_member(...)` filter keeps
-- other clinics out but still shows every patient in your own, ignoring the
-- per-role patients_scope the rest of the app enforces. Measured on a real
-- practitioner whose scope is 'own': the filter showed 1,551 balance rows
-- against the 429 patients they are allowed to see. Under security_invoker
-- both numbers are 429 -- the view and the patients list finally agree.
--
-- Definition below is 0094's, verbatim, with the WITH clause it should never
-- have lost.
create or replace view public.patient_live_balances
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    -- sum() promotes to bigint; cast back to integer (matching patients.balance_cents'
    -- original type) so `recall_candidates` can keep its existing column type.
    (coalesce(pay.paid_cents, 0) - coalesce(inv.invoiced_cents, 0) + coalesce(cred.credit_cents, 0))::integer as balance_cents
  from patients p
  left join lateral (
    select sum(i.total_cents) as invoiced_cents
    from invoices i
    where i.patient_id = p.id and i.status <> 'void'
  ) inv on true
  left join lateral (
    select sum(pay.amount_cents) as paid_cents
    from payments pay
    join invoices i on i.id = pay.invoice_id
    where i.patient_id = p.id and i.status <> 'void'
  ) pay on true
  left join lateral (
    select sum(amount_cents) as credit_cents
    from account_credits
    where patient_id = p.id
  ) cred on true;

-- Defence in depth rather than the load-bearing control: with
-- security_invoker restored, `anon` would read zero rows anyway because
-- patients' own RLS stops it. Every consumer of this view is an authenticated
-- staff page (patients list, recalls, calendar, data exports) or a server
-- route running as service_role, which bypasses RLS regardless -- so nothing
-- legitimate loses access here.
revoke all on public.patient_live_balances from anon;

-- ---------------------------------------------------------------------------
-- 2. Ad-hoc data-repair tables were created without RLS
-- ---------------------------------------------------------------------------
--
-- Six tables created straight against production during the PracticeHub bono
-- reconciliation sat in the `public` schema -- which PostgREST serves -- with
-- RLS disabled, no policies, and Supabase's default SELECT grant to `anon`.
-- With RLS off the grant alone decides, so the public key could read all of
-- them. Between them they carry patient_id, appointment_id, visit dates,
-- amounts and package prices.
--
-- The lesson is the general one, not these six rows: `create table as select`
-- inherits no policies, and the default grants are permissive, so a backup
-- taken to be careful with patient data is itself an exposure of it unless RLS
-- is set in the same breath. Patient-data scratch tables belong in a schema
-- PostgREST does not serve.
--
-- Guarded because these tables exist only in production -- they were never
-- created by a migration. On a fresh local or CI database this block finds
-- nothing and does nothing, rather than failing the whole migration and taking
-- every Cypress shard with it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'appointment_flag_backup_20260912',
    'package_price_manual_20260911',
    'package_sessions_deleted_20260910',
    'package_sessions_reattrib_backup_20260910',
    'ph_packages_snapshot',
    'ph_probe_requests'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      -- No policies deliberately: RLS on with none is deny-all for everyone
      -- except service_role, which is the only thing that should touch a
      -- backup. The revoke makes that explicit rather than relying on it.
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
