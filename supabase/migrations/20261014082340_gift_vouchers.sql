-- Gift vouchers ("bono regalo"): bought online from the clinic's public page
-- (/regalo/<slug>), paid by card through the clinic's own Stripe, sent to the
-- person receiving it with a code, and redeemed online when they book or at
-- the desk from their record.
--
-- A voucher holds one of three things, each switched on per clinic:
--   amount   a euro amount, which becomes credit on the patient's account
--   service  one service (an appointment type) at its price, also credit
--   package  one bono from the clinic's list, which becomes that bono
--
-- Nothing about money is new here. Redeeming records exactly what the desk
-- records for the same thing -- "Add credit" (a payment on account, its
-- credit row and its factura) or selling a bono (the purchase, a payment
-- against it and its factura) -- through server/utils/giftVouchers.ts, so
-- balances, takings and facturas read it the way they already read those.
-- The money sits on the clinic's Stripe from the sale; it enters the patient
-- ledger, and the factura is issued, when the voucher is redeemed.
--
-- No patient_id: the patient is the one the redemption payment names
-- (redeemed_payment_id), and merge_patients moves payments.

create table public.gift_voucher_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default false,
  amounts_cents integer[] not null default '{3000,5000,10000}',
  allow_custom_amount boolean not null default true,
  package_ids uuid[] not null default '{}',
  appointment_type_ids uuid[] not null default '{}',
  valid_months smallint not null default 12 check (valid_months between 1 and 60),
  updated_at timestamptz not null default now()
);

alter table public.gift_voucher_settings enable row level security;
create policy "members select gift_voucher_settings" on public.gift_voucher_settings for select
  using (public.is_account_member(account_id));
create policy "billing insert gift_voucher_settings" on public.gift_voucher_settings for insert
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'));
create policy "billing update gift_voucher_settings" on public.gift_voucher_settings for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'));
select public.require_two_factor_on('public.gift_voucher_settings');

create table public.gift_vouchers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  code text not null unique,
  kind text not null check (kind in ('amount', 'service', 'package')),
  value_cents integer not null check (value_cents > 0),
  package_id uuid references public.packages(id) on delete set null,
  appointment_type_id uuid references public.appointment_types(id) on delete set null,
  item_name text not null,
  to_name text not null check (char_length(to_name) between 1 and 80),
  from_name text not null check (char_length(from_name) between 1 and 80),
  message text check (char_length(message) <= 300),
  -- 'recipient': emailed to them on send_on (or once paid); 'buyer': the code
  -- goes only to the buyer, who hands it over themselves.
  deliver_to text not null check (deliver_to in ('recipient', 'buyer')),
  recipient_email text,
  buyer_email text not null,
  send_on date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'redeemed', 'cancelled')),
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  expires_at timestamptz,
  sent_at timestamptz,
  redeemed_at timestamptz,
  redeemed_payment_id uuid references public.payments(id) on delete set null,
  redeemed_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (deliver_to = 'buyer' or recipient_email is not null)
);
create index gift_vouchers_account_created_idx on public.gift_vouchers (account_id, created_at desc);
create index gift_vouchers_package_id_idx on public.gift_vouchers (package_id);
create index gift_vouchers_appointment_type_id_idx on public.gift_vouchers (appointment_type_id);
create index gift_vouchers_redeemed_payment_id_idx on public.gift_vouchers (redeemed_payment_id);
create index gift_vouchers_redeemed_by_idx on public.gift_vouchers (redeemed_by);
create index gift_vouchers_due_idx on public.gift_vouchers (send_on) where status = 'paid' and sent_at is null;

-- Staff see and resend them where money is taken; the sale, the payment and
-- the redemption are written on the service role by the endpoints.
alter table public.gift_vouchers enable row level security;
create policy "billing select gift_vouchers" on public.gift_vouchers for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_access'));
select public.require_two_factor_on('public.gift_vouchers');
