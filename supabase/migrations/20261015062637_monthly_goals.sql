-- Monthly goals: what the owner aims for this month -- new patients,
-- attended visits, money collected, care plans started -- shown against
-- the month so far on the Dashboard (DashboardMonthlyGoalsWidget) and in
-- the owners' Monday summary. One target per metric per month; a month with
-- none set carries nothing over.
--
-- Owners only, both ways: the targets include income, which the owner reads
-- the way they read Commissions. The figures themselves are computed on the
-- server (server/utils/monthlyGoals.ts) the way the Monday summary computes
-- its week, so the two never disagree.
create table public.monthly_goals (
  account_id uuid not null references public.accounts(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  metric text not null check (metric in ('new_patients', 'visits', 'collected_cents', 'plans_started')),
  target integer not null check (target > 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, month, metric)
);

alter table public.monthly_goals enable row level security;
create policy "owners select monthly_goals" on public.monthly_goals for select using (public.is_account_owner(account_id));
create policy "owners insert monthly_goals" on public.monthly_goals for insert with check (public.is_account_owner(account_id));
create policy "owners update monthly_goals" on public.monthly_goals for update using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));
create policy "owners delete monthly_goals" on public.monthly_goals for delete using (public.is_account_owner(account_id));
select public.require_two_factor_on('public.monthly_goals');
