-- A free trial's plan follows the team, until someone chooses one by hand.
--
-- Every account starts its trial on Solo (create_account_with_owner), and
-- nothing moved it. A clinic of three that invited its colleagues on day one
-- reached the end of the trial still on Solo: "Add card" sent Solo to
-- Checkout, and subscribe.post.ts refused it because Solo covers one
-- practitioner. The trial itself has no seat cap (20260924100032), so nothing
-- earlier had said a word.
--
-- The rule, applied by sync_trial_plan() below:
--
--   two or more practitioners  -> Practice ('pro')
--   one, or none               -> Solo ('starter')
--
-- "Practitioners" is the team's practitioners (is_practitioner, not deleted)
-- plus invites not yet accepted that will become one -- the same
-- coalesce(is_practitioner, role <> 'front_desk') accept_invite() uses -- so
-- the plan is right the moment the owner sends the invites, not only once
-- each colleague has signed in. Past what Practice includes, the extra seats
-- go on the row too, so the card the owner adds covers the whole team rather
-- than being refused for it.
--
-- It only ever applies to a trial that is still the database's to decide:
--
--   * status 'trialing' with no Stripe subscription behind it. Once a card is
--     on file the row mirrors Stripe (platform-billing-webhook), on the plan
--     the owner chose in Checkout.
--   * plan_chosen_at is null. Set on any change of plan_id this function did
--     not make -- the webhook, the admin panel, a hand-run update -- so a
--     plan somebody chose is never undone by the next invite.
--   * on Solo or Practice. Clinic is only ever somebody's choice.
--   * not comped, not on grandfathered limits (limits_waived_on_plan), and
--     never a Blind Spot account (accounts.product = 'blind_spot'): that plan
--     is the product, not a size.
--
-- What decides it is the table, not the page: the Subscription page, the
-- add-card Checkout and every check that reads plan_id all read the same row,
-- so they cannot disagree about which plan the trial is on.

alter table subscriptions add column plan_chosen_at timestamptz;
comment on column subscriptions.plan_chosen_at is
  'When the plan was last set by something other than the trial rule (sync_trial_plan). Null while a trial''s plan still follows the number of practitioners.';

-- How many practitioners the trial is sized for.
create or replace function public.trial_plan_practitioners(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
    select count(*)::int from team_members tm
    where tm.account_id = p_account_id and tm.is_practitioner and tm.deleted_at is null
  ) + (
    select count(*)::int from account_invites ai
    where ai.account_id = p_account_id
      and ai.accepted_at is null
      and coalesce(ai.is_practitioner, ai.role <> 'front_desk')
  );
$function$;

revoke all on function public.trial_plan_practitioners(uuid) from public, anon, authenticated;
grant execute on function public.trial_plan_practitioners(uuid) to service_role;

create or replace function public.sync_trial_plan(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
  v_plan text;
  v_extra integer := 0;
  v_included integer;
begin
  if p_account_id is null then
    return;
  end if;

  -- Checked before any UPDATE is issued, and not only in its WHERE: the
  -- read-only guard on subscriptions is a statement trigger, which fires on
  -- an update that matches no row. A team change in an account that is not
  -- on an open trial must not reach it.
  if not exists (
    select 1
    from subscriptions s
    join accounts a on a.id = s.account_id
    where s.account_id = p_account_id
      and s.status = 'trialing'
      and s.stripe_subscription_id is null
      and not s.comped
      and s.plan_chosen_at is null
      and s.limits_waived_on_plan is null
      and a.product is distinct from 'blind_spot'
      -- A trial left on the Blind Spot plan by an account that has moved to
      -- the whole product is moved on too.
      and (s.plan_id in ('starter', 'pro') or (s.plan_id = 'blind_spot' and a.product = 'clinic'))
  ) then
    return;
  end if;

  v_count := trial_plan_practitioners(p_account_id);
  if v_count >= 2 then
    v_plan := 'pro';
    select included_professionals into v_included from plans where id = 'pro';
    if v_included is not null then
      v_extra := greatest(0, v_count - v_included);
    end if;
  else
    v_plan := 'starter';
  end if;

  -- Marks the write as this rule's, so subscriptions_plan_chosen_at below
  -- does not record it as somebody's choice. Local to the transaction, and
  -- put back straight after, so a later hand-made change in the same
  -- transaction is still recorded.
  perform set_config('quiroflow.trial_plan_rule', 'on', true);
  update subscriptions
  set plan_id = v_plan, extra_professionals = v_extra
  where account_id = p_account_id
    and (plan_id is distinct from v_plan or extra_professionals is distinct from v_extra);
  perform set_config('quiroflow.trial_plan_rule', 'off', true);
end;
$function$;

revoke all on function public.sync_trial_plan(uuid) from public, anon, authenticated;
grant execute on function public.sync_trial_plan(uuid) to service_role;

-- Any other change of plan is somebody's choice, and from then on the rule
-- leaves the row alone. Moving onto or off the Blind Spot plan is the product
-- switch (/api/blind-spot/product), not a choice of size, so it is not one.
create or replace function public.subscriptions_plan_chosen_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('quiroflow.trial_plan_rule', true), '') = 'on' then
    return new;
  end if;
  if old.plan_id = 'blind_spot' or new.plan_id = 'blind_spot' then
    return new;
  end if;
  new.plan_chosen_at := coalesce(new.plan_chosen_at, now());
  return new;
end;
$function$;

create trigger subscriptions_plan_chosen_at
  before update of plan_id on subscriptions
  for each row
  when (old.plan_id is distinct from new.plan_id)
  execute function public.subscriptions_plan_chosen_at();

-- What moves it: a practitioner added, removed or changed, an invite sent,
-- accepted or withdrawn, and the switch between Blind Spot and the whole
-- product. Security definer so that whoever made the change -- staff through
-- PostgREST, accept_invite, a cron -- reaches sync_trial_plan, which nobody
-- else may call.
create or replace function public.team_change_syncs_trial_plan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform sync_trial_plan(new.account_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.account_id is distinct from new.account_id) then
    perform sync_trial_plan(old.account_id);
  end if;
  return null;
end;
$function$;

revoke all on function public.team_change_syncs_trial_plan() from public, anon, authenticated;

create trigger team_members_sync_trial_plan
  after insert or delete or update of is_practitioner, deleted_at, account_id on team_members
  for each row execute function public.team_change_syncs_trial_plan();

create trigger account_invites_sync_trial_plan
  after insert or delete or update of accepted_at, is_practitioner, role, account_id on account_invites
  for each row execute function public.team_change_syncs_trial_plan();

create or replace function public.product_change_syncs_trial_plan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform sync_trial_plan(new.id);
  return null;
end;
$function$;

revoke all on function public.product_change_syncs_trial_plan() from public, anon, authenticated;

create trigger accounts_product_sync_trial_plan
  after update of product on accounts
  for each row
  when (old.product is distinct from new.product)
  execute function public.product_change_syncs_trial_plan();

-- The trials open today. Every trial starts on Solo, so one that is on any
-- other plan was put there by somebody (on 27 Nov 2026: two of nine, both on
-- Practice) -- that is a choice, recorded before the rule runs so it is not
-- taken back to Solo the day the team shrinks. A trial with a Checkout behind
-- it is excluded by the rule itself.
update subscriptions
set plan_chosen_at = now()
where status = 'trialing'
  and stripe_subscription_id is null
  and plan_id not in ('starter', 'blind_spot');

-- Then the rest are sized to their team, so a clinic already halfway through
-- a trial does not end it on Solo.
do $$
declare
  r record;
begin
  for r in select account_id from subscriptions where status = 'trialing' and stripe_subscription_id is null loop
    perform sync_trial_plan(r.account_id);
  end loop;
end;
$$;
