-- Stripe subscriptions made outside QuiroFlow, synced as patient memberships.
--
-- A clinic charges some memberships as subscriptions it set up in its own
-- Stripe account (the dashboard, PracticeHub), not through the Billing tab's
-- autopay. Each one is paired with a patient here -- found by email or phone,
-- or created -- and given the membership its Stripe price stands for, so the
-- memberships report, the ledger and the patient's Billing tab show it like
-- any other. Screen: Settings > Import > Stripe subscriptions
-- (components/import/StripeSubscriptions.vue); logic:
-- server/utils/stripeMembershipSync.ts.
--
-- Layered on payment_schedules like GoCardless was: an imported subscription
-- is a schedule with a stripe_subscription_id and no Subscription Schedule of
-- ours, so the invoice.paid handler that already books each paid period
-- (stripeWebhookHandlers.ts) books these too.

-- ---------------------------------------------------------------------
-- Which QuiroFlow plan each Stripe price is
-- ---------------------------------------------------------------------
-- Several prices may be the same plan (a monthly and a yearly price of one
-- product, an old price kept for existing members); a price is one plan.
-- Written only by the server after its billing_config guard; read by staff.
create table public.stripe_membership_prices (
  account_id uuid not null references public.accounts(id) on delete cascade,
  stripe_price_id text not null,
  stripe_product_id text,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, stripe_price_id)
);
create index stripe_membership_prices_membership_idx on public.stripe_membership_prices (membership_id);

alter table public.stripe_membership_prices enable row level security;
create policy "staff read stripe_membership_prices" on public.stripe_membership_prices
  for select using (public.is_account_member(account_id));

select public.require_two_factor_on('public.stripe_membership_prices');
select public.grant_data_api('public.stripe_membership_prices');

-- ---------------------------------------------------------------------
-- Schedules that are someone else's subscription
-- ---------------------------------------------------------------------
-- created_here: QuiroFlow made the Subscription Schedule (create-schedule.post.ts).
-- imported: a subscription made elsewhere and paired here. It may have no
-- Subscription Schedule at all, so the provider check accepts either id.
alter table public.payment_schedules
  add column origin text not null default 'created_here' check (origin in ('created_here', 'imported')),
  -- The pairing took over a membership the desk had already recorded, rather
  -- than creating one. Undoing the pairing (unlink.post.ts) then leaves that
  -- membership where it was instead of deleting it.
  add column adopted_membership boolean not null default false;

alter table public.payment_schedules drop constraint payment_schedules_provider_ids_check;
alter table public.payment_schedules
  add constraint payment_schedules_provider_ids_check check (
    (provider = 'stripe' and (stripe_subscription_schedule_id is not null or stripe_subscription_id is not null))
    or (provider = 'gocardless' and gocardless_subscription_id is not null and gocardless_mandate_id is not null)
  );

-- One schedule per subscription: a created and an updated event racing, or
-- the import screen and a webhook at once, must not pair it twice.
create unique index payment_schedules_stripe_subscription_once
  on public.payment_schedules (account_id, stripe_subscription_id) where stripe_subscription_id is not null;

-- ---------------------------------------------------------------------
-- The Stripe invoice a payment is
-- ---------------------------------------------------------------------
-- A paid membership period names the Stripe invoice it was. That is what lets
-- the same money arriving by two roads be counted once: a clinic still
-- importing its ledger from PracticeHub may already hold this charge as a
-- 'phpay-' payment, and the webhook then marks that one instead of booking
-- another (stripeMembershipSync.ts, claimImportedStripePayment); a
-- PracticeHub payment arriving after the webhook booked it is adopted the
-- same way (utils/practicehubImport/ledger.ts).
alter table public.payments add column stripe_invoice_id text;
create unique index payments_stripe_invoice_id_once
  on public.payments (account_id, stripe_invoice_id) where stripe_invoice_id is not null;

-- The audit trail (CLAUDE.md), appended to whatever the constraint allows
-- when this runs rather than restated.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['stripe_membership_price']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_stripe_membership_prices after insert or update or delete on public.stripe_membership_prices
  for each row execute function public.fn_audit_log('stripe_membership_price');
