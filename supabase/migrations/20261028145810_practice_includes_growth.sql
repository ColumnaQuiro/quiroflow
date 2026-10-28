-- Solo down to 45 EUR, and Growth included in Practice as well as Clinic.
--
-- Decided 28 Oct 2026:
--
--   Solo      45 EUR/month, 40 EUR/month billed annually (480 EUR/year).
--             Growth stays an add-on here, at 39 EUR (35 annual), so
--             Solo + Growth is 84 EUR.
--   Practice  99 EUR/month, 89 annual -- unchanged -- and now Growth is in
--             the price.
--   Clinic    149 EUR/month, 134 annual -- unchanged, Growth included as
--             before.
--
-- Growth being included is read from the plan, not written onto rows
-- (utils/growthPlans.ts, PLANS_INCLUDING_GROWTH), so the only database half
-- of that is inbox_growth_account_ids() below, the SQL copy of the same list.
-- No subscription row changes: growth_addon stays whatever it was, and a
-- Practice account with it set simply has it twice over, harmlessly.
--
-- Every figure excludes IVA; Stripe adds the 21% from the fixed tax rate in
-- subscribe.post.ts.
--
-- Safe to apply without touching a customer: there is still no Stripe
-- subscription on any plan, only comped, trialing and locked rows, so
-- nothing is reprorated and nobody is emailed.

update plans set
  monthly_price_cents = 4500,
  annual_price_cents = 4000
where id = 'starter';

-- The Stripe prices, in the same migration as the cents so the app never
-- quotes one number while Stripe charges another (see
-- 20260917141806_reprice_plans_and_growth.sql for why that matters).
--
-- Created on 2026-10-28 in the platform billing account
-- (acct_1UD1lr0Ov3CXtGBc), on the existing product "QuiroFlow Solo"
-- (`starter`), tax behaviour exclusive. Each id was read back from its own
-- price page and checked against its amount and interval. Practice and
-- Clinic keep their prices, so their ids do not move. The 49/528 Solo prices
-- are left active: nothing references them after this, and archiving them is
-- dashboard housekeeping.
update plans set
  stripe_monthly_price_id = 'price_1UVYHh0Ov3CXtGBc7Ag2jPfo',  -- 45,00 EUR / month
  stripe_annual_price_id = 'price_1UVYID0Ov3CXtGBcvx48cPQl'    -- 480,00 EUR / year (40 EUR/mo)
where id = 'starter';

-- PLANS_INCLUDING_GROWTH in SQL, so the Inbox does not show a Practice
-- clinic each lead twice (once as a lead, once as a bare number). Otherwise
-- identical to 20260930142159_inbox_lead_messages_without_growth.sql.
create or replace function public.inbox_growth_account_ids()
returns setof uuid
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select s.account_id
  from subscriptions s
  group by s.account_id
  having count(*) = 1
     and bool_and(
       s.comped
       or s.status = 'trialing'
       -- PLANS_INCLUDING_GROWTH in utils/growthPlans.ts
       or ((s.growth_addon or s.plan_id in ('pro', 'clinic')) and s.status not in ('locked', 'canceled'))
     );
$function$;

revoke all on function public.inbox_growth_account_ids() from public, anon;
grant execute on function public.inbox_growth_account_ids() to authenticated;
