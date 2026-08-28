-- Discount codes for the public online booking widget (pages/book/[slug].vue).
-- Exactly one of percent_off/amount_off_cents is expected to be set per row --
-- left as an application-level convention (like appointment_type_overrides'
-- nullable duration/price columns) rather than a DB constraint, since a
-- future code type might reasonably want both.
create table online_booking_discount_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  code text not null,
  percent_off int,
  amount_off_cents int,
  active boolean not null default true,
  expires_at timestamptz,
  max_uses int,
  times_used int not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, code)
);

create index online_booking_discount_codes_account_idx on online_booking_discount_codes (account_id);

alter table online_booking_discount_codes enable row level security;

create policy "staff manage online_booking_discount_codes" on online_booking_discount_codes
  for all using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'clinic_config'));

-- The public booking widget has no session, so validating/redeeming a code
-- goes through a security-definer RPC (see create_public_booking in
-- 0106_online_booking_rpc_updates.sql) rather than a public SELECT policy.
