-- "¡Recomienda a tus amigos!", clinic to clinic: when a clinic that signed up
-- through another clinic's link starts paying, both get 10% of their regular
-- plan's monthly price off one invoice. accounts.referred_by_account_id (0137)
-- has recorded who referred whom since the link existed; this table records
-- what each side has been given for it, so the discount is granted once and
-- only once. (Not to be confused with the PATIENT referral programme,
-- 20261012125117, which is patients.referral_rewarded_at.)
--
-- One row per (referred clinic, side):
--   role 'referred' -- the new clinic's own discount, on its first paid invoice
--   role 'referrer' -- the referring clinic's, on its next invoice after the
--                      new clinic's first payment
-- account_id is always the clinic that RECEIVES the discount.
--
-- Written only by the platform billing webhook and /api/billing/subscribe
-- (service role), see server/utils/clinicReferralRewards.ts. Owners can read
-- their own clinic's rows.
create table public.clinic_referral_rewards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  referred_account_id uuid not null references public.accounts(id) on delete cascade,
  role text not null check (role in ('referred', 'referrer')),
  status text not null default 'pending' check (status in ('pending', 'applied')),
  -- 10% of the plan's monthly price, ex-VAT, fixed when the coupon is made,
  -- and the one-use Stripe coupon carrying it.
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  stripe_coupon_id text,
  stripe_invoice_id text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (referred_account_id, role),
  check (role <> 'referred' or account_id = referred_account_id)
);

create index clinic_referral_rewards_pending_idx on public.clinic_referral_rewards (account_id) where status = 'pending';

alter table public.clinic_referral_rewards enable row level security;
create policy "owners view their clinic referral rewards" on public.clinic_referral_rewards
  for select using (public.is_account_owner(account_id));
select public.require_two_factor_on('public.clinic_referral_rewards');
select public.grant_data_api('public.clinic_referral_rewards');

-- ---------------------------------------------------------------------
-- Audit trail: it is money
-- ---------------------------------------------------------------------
-- Read-and-append, as 20261113071649 does, so this keeps whatever types other
-- migrations have added whichever order they apply in.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['clinic_referral_reward']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_clinic_referral_rewards after insert or update or delete on public.clinic_referral_rewards
  for each row execute function public.fn_audit_log('clinic_referral_reward', '');
