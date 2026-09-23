-- Tell the app whether a trialing account has already put a card on file.
--
-- A trial can now be carried into Stripe: an owner who adds a card on day 3
-- starts a Stripe subscription that stays `trialing` until the trial's own end
-- date and charges then (checkoutTrialEnd in utils/billing.ts). The row looks
-- exactly like a trial nobody has acted on -- status 'trialing', a
-- trial_ends_at -- so the banner at the top of every page would keep saying
-- "N days left in your trial · Upgrade now" to a clinic that had done exactly
-- that, and "Upgrade now" led to a page telling them to add the card they had
-- just added.
--
-- A Stripe subscription existing is the fact that separates the two, and it is
-- the same one pages/subscription.vue already keys off. Only a boolean leaves
-- here, not the id: nothing in the store needs it, and every staff member's
-- bootstrap carries this object.
--
-- The rest of the function is unchanged from
-- 20260917141806_reprice_plans_and_growth.sql; the new key is the only
-- addition, so code already live keeps reading the keys it reads today.

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
            select status, trial_ends_at, growth_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;
