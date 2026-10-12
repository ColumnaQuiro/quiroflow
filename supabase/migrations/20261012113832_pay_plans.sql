-- Pay plans: what each team member earns, as the parts a clinic combines
-- (utils/payPlan.ts computes the month): a fixed monthly base, a % of the
-- payments received for their visits and patients, an amount per attended
-- visit with optional tiers by the month's count, a bonus per new patient,
-- and a % of the bonos and memberships they sold. Reports > Commissions reads
-- it beside the month's figures.
--
-- One row per team member, written by owners only -- pay is between the
-- clinic and the person. Each member may read their own row, nobody else's.
create table public.pay_plans (
  team_member_id uuid primary key references public.team_members(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  base_cents integer not null default 0 check (base_cents >= 0),
  payments_pct numeric(5, 2) not null default 0 check (payments_pct between 0 and 100),
  visit_cents integer not null default 0 check (visit_cents >= 0),
  -- 'reached': every visit at the rate of the tier reached that month;
  -- 'band': each visit at the rate of its own band, like tax brackets;
  -- 'bonus': visit_cents per visit plus a lump for each tier reached.
  tier_mode text not null default 'reached' check (tier_mode in ('reached', 'band', 'bonus')),
  -- [{ "from": 20, "cents": 1200 }, ...]
  tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  new_patient_cents integer not null default 0 check (new_patient_cents >= 0),
  sales_pct numeric(5, 2) not null default 0 check (sales_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.team_members(id) on delete set null
);
create index pay_plans_account_idx on public.pay_plans (account_id);

alter table public.pay_plans enable row level security;
create policy "owners manage pay plans" on public.pay_plans
  for all using (public.is_account_owner(account_id))
  with check (public.is_account_owner(account_id));
create policy "members read their own pay plan" on public.pay_plans
  for select using (team_member_id = public.current_team_member_id(account_id));
select public.require_two_factor_on('public.pay_plans');
