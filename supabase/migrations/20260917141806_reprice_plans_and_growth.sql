-- Reprice the plans and the Growth add-on, and bundle Growth into Clinic.
--
-- Priced against the clinics QuiroFlow is actually sold to, which is not the
-- market the old numbers were set against. A chiropractic clinic shopping for
-- software today pays PracticeHub roughly 115 EUR/month for one practitioner
-- (GBP 100 + GBP 20 each after that), or QuiroHiro 67 EUR, or Doctoralia 89
-- EUR per professional. The 29-49 EUR products -- Clinic Cloud, DocFav, Sammy
-- -- are generalist tools that do not know what a chiropractor is.
--
-- Two numbers drove the changes:
--
--   Seats. 29 EUR per extra professional put a six-person clinic at 169 EUR
--   against QuiroHiro Plus at 97 EUR with unlimited users. No feature list
--   survives that comparison on the same page. Seats drop to 19 EUR and the
--   Clinic tier goes unlimited, which answers it directly and still saves
--   that clinic about 80 EUR/month against PracticeHub.
--
--   Growth. 49 EUR made "Solo + Growth" 98 EUR, one euro the wrong side of
--   QuiroHiro Plus. At 39 EUR it is 88 EUR and wins outright. It also lands
--   just above the 30 EUR the market charges for an AI layer (Doctoralia's
--   Noa Notes; QuiroHiro's Basic-to-Plus step), which is the right side of
--   that anchor for something that also does lead capture and reputation.
--
-- Clinic includes Growth rather than selling it alongside: see
-- utils/growthPlans.ts. The entitlement is read from the plan, so no Growth
-- line item is billed and growth_addon stays false on those rows.
--
-- Every figure here is per month and excludes IVA -- the 21% is applied by
-- Stripe as a fixed tax rate (server/api/billing/subscribe.post.ts), and
-- annual prices are billed twelve at a time.
--
-- Safe to apply without touching a customer: there are no Stripe
-- subscriptions at all yet, only comped and trialing rows, so nothing is
-- reproated and nobody is emailed.

update plans set
  monthly_price_cents = 4900,
  annual_price_cents = 4400,
  extra_professional_price_cents = 1900
where id = 'starter';

-- Practice gains a seat (3 -> 4). At 19 EUR a seat the extra one costs less
-- than the old price of the plan's third.
update plans set
  monthly_price_cents = 9900,
  annual_price_cents = 8900,
  included_professionals = 4,
  extra_professional_price_cents = 1900
where id = 'pro';

-- included_professionals null is "unlimited", the same convention
-- included_clinics already uses on this row.
update plans set
  monthly_price_cents = 14900,
  annual_price_cents = 13400,
  included_professionals = null,
  extra_professional_price_cents = 1900
where id = 'clinic';

update addons set
  monthly_price_cents = 3900,
  annual_price_cents = 3500
where id = 'growth';

-- The account store decides whether to render the Growth screens, and after
-- this it needs the plan to do it -- otherwise a Clinic account sees the
-- tabs hidden while the API happily serves them, or the reverse. The rest of
-- the function is unchanged; plan_id is the only addition.
create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
    limit 1
  )
  select case
    when not exists (select 1 from me) then jsonb_build_object('team_member', null)
    else (
      select jsonb_build_object(
        'team_member', to_jsonb(me.*),
        'account', (
          select to_jsonb(a) from (
            select name, slug, whatsapp_confirmation_template_name,
                   whatsapp_recall_template_name, scheduling_policy_fee_cents,
                   default_phone_country
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at, growth_addon, plan_id, comped
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;

-- The Stripe prices themselves.
--
-- Stripe prices are immutable: an amount cannot be edited, only replaced. So
-- these are ten new Price objects created in the live account
-- (acct_1UD1lr0Ov3CXtGBc) on 2026-09-17, and the columns below are repointed
-- at them in the same migration as the cents above. Split across two
-- migrations and there would be a window where the app quotes 49 EUR and
-- Stripe charges 59 -- which is the exact failure mode the check on
-- `plans.monthly_price_cents` cannot catch, because the amount that gets
-- charged never lives in this database.
--
-- Every id below was read back from its own price page and checked against
-- its amount and interval, rather than inferred from the order of rows in
-- the dashboard. Annual prices are a yearly interval at twelve times the
-- per-month figure, matching what the previous ones did (Solo annual was
-- 600 EUR/year against annual_price_cents = 5000).
--
-- Tax behaviour on all ten is "exclusive": the 21% IVA is added by Stripe
-- from the fixed rate in subscribe.post.ts, not folded into these amounts.
--
-- The old prices are left active deliberately. Nothing references them once
-- this runs, no subscription is on one, and archiving them is reversible
-- housekeeping that does not need to ride a migration.

update plans set
  stripe_monthly_price_id = 'price_1UGgXZ0Ov3CXtGBc3k7rZkT7',                      -- 49,00 EUR / month
  stripe_annual_price_id = 'price_1UGgZP0Ov3CXtGBc66Lxky4v',                       -- 528,00 EUR / year
  stripe_extra_professional_monthly_price_id = 'price_1UGgms0Ov3CXtGBcICMEqBI5',   -- 19,00 EUR / month
  stripe_extra_professional_annual_price_id = 'price_1UGgoN0Ov3CXtGBcGynLbRHP'     -- 228,00 EUR / year
where id = 'starter';

update plans set
  stripe_monthly_price_id = 'price_1UGgar0Ov3CXtGBcYlb2qtU8',                      -- 99,00 EUR / month
  stripe_annual_price_id = 'price_1UGgcT0Ov3CXtGBcr20TnVek',                       -- 1.068,00 EUR / year
  stripe_extra_professional_monthly_price_id = 'price_1UGgms0Ov3CXtGBcICMEqBI5',
  stripe_extra_professional_annual_price_id = 'price_1UGgoN0Ov3CXtGBcGynLbRHP'
where id = 'pro';

update plans set
  stripe_monthly_price_id = 'price_1UGgel0Ov3CXtGBcVYEdoZKG',                      -- 149,00 EUR / month
  stripe_annual_price_id = 'price_1UGgfu0Ov3CXtGBc4MEVE1fq',                       -- 1.608,00 EUR / year
  stripe_extra_professional_monthly_price_id = 'price_1UGgms0Ov3CXtGBcICMEqBI5',
  stripe_extra_professional_annual_price_id = 'price_1UGgoN0Ov3CXtGBcGynLbRHP'
where id = 'clinic';

update addons set
  stripe_monthly_price_id = 'price_1UGghs0Ov3CXtGBcB8i1X5fD',                      -- 39,00 EUR / month
  stripe_annual_price_id = 'price_1UGgkf0Ov3CXtGBcUSa5pJGN'                        -- 420,00 EUR / year
where id = 'growth';
