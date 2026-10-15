-- The AI receptionist as an add-on of its own, as well as inside Growth.
--
-- A clinic that only wants WhatsApp answered -- not the lead pipeline,
-- reputation or ad attribution -- had to buy all of Growth to get it. It is
-- sold on its own now, and stays included in Growth (and so in the Clinic
-- plan, which includes Growth).
--
-- Priced on what a reply costs, measured on 14 Oct 2026: about 0.026 USD per
-- reply before the briefing was cached (#746), about 0.009 after. EUR 19 a
-- month includes 1,000 replies; past that each further 1,000 (or part) is
-- EUR 15, for Growth and Clinic accounts too -- the replies cost the same
-- whoever is paying for them. The allowance and the extra blocks arrive with
-- the reply counter; this migration is only what is bought.
--
-- Same shape as Growth (20260915171053_growth_addon.sql): a row in the
-- catalogue, a column on the subscription that the platform billing webhook
-- writes from the Stripe items, and the server deciding from it.
--
-- Per month and excluding IVA, like every price here. EUR 17 a month billed
-- annually: the same ~10% Growth gives for paying yearly. The Stripe price ids
-- stay null until they are created in the platform account; subscribe refuses
-- to sell it for an interval with no price rather than quietly leaving it out.
insert into addons (id, name, monthly_price_cents, annual_price_cents) values
  ('receptionist', 'AI receptionist', 1900, 1700);

alter table subscriptions add column receptionist_addon boolean not null default false;

comment on column subscriptions.receptionist_addon is
  'Whether this account has bought the AI receptionist on its own. Growth (bought, or included in the plan) includes it without this being set; hasReceptionist() reads both.';

-- The screens decide whether to show the receptionist from the bootstrap, so
-- it carries the new column. Otherwise unchanged from
-- 20260924164000_clinic_contact_and_archive.sql.
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
      and public.mfa_satisfied()
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
                   default_phone_country, require_two_factor
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id and archived_at is null
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at, growth_addon, receptionist_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;
