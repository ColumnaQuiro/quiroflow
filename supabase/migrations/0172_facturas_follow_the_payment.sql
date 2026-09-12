-- The fiscal document follows the money, not the visit.
--
-- Until now one invoices row did two jobs: it was the charge that moves a
-- patient's balance AND the document that would be handed over as a factura.
-- Those are not the same event. A patient hands over 528 EUR for a bono and
-- receives nothing; twelve visits later they have twelve documents for a
-- service they already paid for. For a prepayment the obligation generally
-- arises when the money is received -- the one moment that produced no
-- paperwork.
--
-- So the charge stays where it is (invoices, one per visit, what the balance
-- is computed from) and the fiscal document moves here, one per payment.
--
-- Deliberately NOT retrospective. The 3,280 payments imported from
-- PracticeHub get nothing: that was the clinic's decision, and it is why this
-- is a few days of work rather than a reissue of three years of history.

create table facturas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  -- One factura per payment. A payment is the fiscal event; issuing two
  -- documents for one movement of money is exactly the confusion being
  -- removed here.
  payment_id uuid not null unique references payments(id) on delete cascade,
  number text not null,
  -- 'simplified' is the everyday case: a visit, a small amount, no recipient
  -- details required. 'full' carries the patient's NIF and address and is what
  -- a bono purchase gets.
  kind text not null default 'simplified' check (kind in ('simplified', 'full')),
  -- What the money bought, in the patient's words rather than the schema's:
  -- "Bono 12 - 264.00 EUR of 528.00 EUR (6 of 12 sessions)", or the service
  -- for a visit, or credit on account.
  description text not null,
  amount_cents integer not null,
  -- Who the document is made out to. Null on all three means "resolve from the
  -- patient record when it is rendered", which is what makes a NIF added next
  -- week appear on a factura issued today -- reception should not have to stop
  -- the counter to collect it.
  --
  -- Setting them freezes the document. That matters once one has actually been
  -- delivered: a factura in someone's hands should not quietly change because
  -- the patient later moved house. It is also the way to correct one without
  -- editing the patient record, which other facturas read from.
  recipient_name text,
  recipient_nif text,
  recipient_address text,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index facturas_account_number_uniq on facturas (account_id, number);
create index facturas_patient_idx on facturas (account_id, patient_id);
create index facturas_issued_idx on facturas (account_id, issued_at);

comment on table facturas is
  'The fiscal document, one per payment. invoices holds the charges that drive the balance; this holds what the patient is given.';
comment on column facturas.kind is
  'simplified for an everyday visit; full (NIF + address) for a bono purchase or any larger amount.';
comment on column facturas.recipient_nif is
  'Null resolves from the patient at render time; set freezes it. Same for recipient_name and recipient_address.';

alter table facturas enable row level security;

create policy "staff read facturas" on facturas
for select using (
  account_id in (select my_member_account_ids())
  and (
    account_id in (select my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from my_own_patient_access())
  )
);

create policy "staff write facturas" on facturas
for all using (
  account_id in (select my_member_account_ids())
  and account_id in (select my_permitted_accounts('payments_allocate'))
) with check (
  account_id in (select my_member_account_ids())
  and account_id in (select my_permitted_accounts('payments_allocate'))
);

-- A patient sees their own, in the portal and the app.
create policy "patients view own facturas" on facturas
for select using (
  patient_id in (select p.id from patients p where p.user_id = auth.uid())
);

-- ---------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------
--
-- Its own series, separate from the INV- run that charges have used. Those
-- 7,037 charges stop being fiscal documents, and a fiscal series should not
-- inherit a numbering history that was never one.
--
-- Year-scoped, which is the common Spanish shape: F-2026-0001. If the gestor
-- prefers one continuous run, this is the only place that decides it.
create table factura_number_sequences (
  account_id uuid not null references accounts(id) on delete cascade,
  year integer not null,
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, year)
);

alter table factura_number_sequences enable row level security;

comment on table factura_number_sequences is
  'Per-account, per-year counter behind next_factura_number(). Never decreases; not to be edited by hand.';

create or replace function next_factura_number(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_number bigint;
begin
  if auth.uid() is not null and not has_permission(p_account_id, 'payments_allocate') then
    raise exception 'Not permitted';
  end if;

  -- Same shape as next_invoice_number(): the upsert takes a row lock, so two
  -- concurrent callers serialize rather than both reading the same value. A
  -- count would not do -- it falls when a row is deleted, which is how seven
  -- invoice numbers came to be held by two patients each.
  insert into factura_number_sequences (account_id, year, next_number)
  values (p_account_id, v_year, 2)
  on conflict (account_id, year) do update
    set next_number = factura_number_sequences.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_number;

  return 'F-' || v_year || '-' || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function next_factura_number(uuid) from public;
grant execute on function next_factura_number(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- What a payment was for
-- ---------------------------------------------------------------------
--
-- The description above has to come from somewhere, and today it cannot: of
-- 1,316 payments in the last twelve months, ZERO carry a bono link, because
-- PracticeHub records no allocation and everything arrived unattached.
-- package_purchase_id already exists for the bono case; this says which of the
-- three kinds a payment is, so the factura can describe it without guessing.
alter table payments add column purpose text
  check (purpose is null or purpose in ('visit', 'bono', 'membership', 'on_account'));

comment on column payments.purpose is
  'What the money was for, captured when it is taken: visit, bono, membership, or on_account. Null on everything imported from PracticeHub, which recorded no such thing.';
