-- Third-party payers: insurers (mutuas -- Sanitas, Adeslas, Mapfre, DKV),
-- medico-legal schemes (traffic accidents, work accidents) and companies that
-- pay for a patient's treatment. From the PracticeHub 2.0 comparison, 22 Oct
-- 2026: physiotherapy clinics bill a mutua for most of their visits, and
-- QuiroFlow had no payer other than the patient.
--
-- The third party's share is NOT an invoice. Everything that answers "what
-- does this patient owe?" -- patient_live_balances, utils/owing.ts, the
-- debtors report, the dashboard widget, the banner, the ledger, the portal,
-- automations and the app -- reads invoices and payments by patient_id, forty
-- places at the last count. An invoice for the mutua's share hung on the
-- patient would have had to be excluded in every one of them, and the one
-- that was missed would chase the patient for the insurer's money. So:
--
--   * The patient's receipt for a visit holds only the patient's share (the
--     copago, often nothing). Their balance, debt and facturas work exactly
--     as they always have, because to them this is an ordinary receipt.
--   * The third party's share is a third_party_charges row, settled by
--     third_party_payments through third_party_payment_allocations. Nothing
--     that reads invoices or payments ever sees it.
--
-- Facturas addressed to the third party are deliberately NOT here. A factura
-- belongs to one payment and one patient (facturas.payment_id, patient_id not
-- null) and its recipient resolves from patient records in facturaData.ts and
-- verifactuSender.ts; a mutua's factura is one monthly document across many
-- patients. That is a change to the fiscal chain's sender and gets its own PR.
-- What a clinic hands the third party until then is the statement
-- (liquidación), which is not a fiscal document.

-- ---------------------------------------------------------------------
-- Who pays
-- ---------------------------------------------------------------------
create table public.third_parties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'insurer' check (kind in ('insurer', 'medico_legal', 'company')),
  tax_id text,
  address text,
  email text,
  phone text,
  contact_name text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index third_parties_account_name_uniq on public.third_parties (account_id, lower(btrim(name)));
select public.grant_data_api('public.third_parties');

alter table public.third_parties enable row level security;
create policy "staff select third_parties" on public.third_parties for select
  using (public.is_account_member(account_id));
create policy "staff manage third_parties" on public.third_parties for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'));
select public.require_two_factor_on('public.third_parties');

-- What a third party pays for a type of visit, and what the patient pays on
-- top (the copago). Optional: without a rate, charging a visit to the third
-- party offers the visit's own price and no copago, and either can be edited.
create table public.third_party_rates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  third_party_id uuid not null references public.third_parties(id) on delete cascade,
  appointment_type_id uuid not null references public.appointment_types(id) on delete cascade,
  pays_cents integer not null check (pays_cents >= 0),
  copay_cents integer not null default 0 check (copay_cents >= 0),
  created_at timestamptz not null default now(),
  constraint third_party_rates_one_per_type unique (third_party_id, appointment_type_id)
);
create index third_party_rates_type_idx on public.third_party_rates (appointment_type_id);
select public.grant_data_api('public.third_party_rates');

alter table public.third_party_rates enable row level security;
create policy "staff select third_party_rates" on public.third_party_rates for select
  using (public.is_account_member(account_id));
create policy "staff manage third_party_rates" on public.third_party_rates for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config'))
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'billing_config')
    and exists (select 1 from public.third_parties tp where tp.id = third_party_id and tp.account_id = third_party_rates.account_id)
  );
select public.require_two_factor_on('public.third_party_rates');

-- ---------------------------------------------------------------------
-- The patient's cover
-- ---------------------------------------------------------------------
-- A patient's policy or case with a third party. authorized_sessions and
-- valid_until are what the insurer authorised; the app warns, it does not
-- refuse, when a visit goes past either -- the clinic may have a new
-- authorisation on paper before anyone types it in.
create table public.patient_third_parties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- Restrict: a third party a patient is covered by is retired (active =
  -- false), not deleted.
  third_party_id uuid not null references public.third_parties(id) on delete restrict,
  policy_number text,
  authorization_number text,
  authorized_sessions integer check (authorized_sessions is null or authorized_sessions > 0),
  valid_until date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null
);
create index patient_third_parties_patient_idx on public.patient_third_parties (patient_id);
create index patient_third_parties_third_party_idx on public.patient_third_parties (third_party_id);
select public.grant_data_api('public.patient_third_parties');

alter table public.patient_third_parties enable row level security;
create policy "staff select patient_third_parties" on public.patient_third_parties for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));
create policy "staff manage patient_third_parties" on public.patient_third_parties for all
  using (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and (public.has_permission(account_id, 'billing_access') or public.has_permission(account_id, 'patients_edit'))
  )
  with check (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and (public.has_permission(account_id, 'billing_access') or public.has_permission(account_id, 'patients_edit'))
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_third_parties.account_id)
    and exists (select 1 from public.third_parties tp where tp.id = third_party_id and tp.account_id = patient_third_parties.account_id)
  );
select public.require_two_factor_on('public.patient_third_parties');

-- ---------------------------------------------------------------------
-- What a third party owes
-- ---------------------------------------------------------------------
-- One row per visit share a third party owes. Never deleted: voided, so a
-- statement already sent still adds up.
--
-- patient_id is RESTRICT, unlike nearly everything else keyed to a patient.
-- This is money owed to the clinic, and a cascade would take it quietly with
-- the patient row -- including in merge_patients, should a later rewrite of
-- that function start from a copy without the line that moves it. Restrict
-- turns that into a loud failure, as facturas' does; DeleteDialog refuses
-- before the database is reached.
create table public.third_party_charges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  third_party_id uuid not null references public.third_parties(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  patient_third_party_id uuid references public.patient_third_parties(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  -- The patient's receipt for the same visit, and the line on it that now
  -- holds the copago. list_price_cents and line_description are what that
  -- line said before, so taking the third party off puts it back.
  invoice_id uuid references public.invoices(id) on delete set null,
  invoice_line_item_id uuid references public.invoice_line_items(id) on delete set null,
  list_price_cents integer,
  line_description text,
  service_date date not null,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  -- As they were when the visit was charged: a statement for March names
  -- the authorisation March's visits were under, not today's.
  policy_number text,
  authorization_number text,
  status text not null default 'pending' check (status in ('pending', 'void')),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null
);
create index third_party_charges_third_party_idx on public.third_party_charges (third_party_id, service_date);
create index third_party_charges_patient_idx on public.third_party_charges (patient_id);
create index third_party_charges_link_idx on public.third_party_charges (patient_third_party_id) where patient_third_party_id is not null;
create index third_party_charges_invoice_idx on public.third_party_charges (invoice_id) where invoice_id is not null;
-- A visit is charged to a given third party once. Two taps on two screens
-- would otherwise bill the mutua twice for one session.
create unique index third_party_charges_one_per_visit on public.third_party_charges (appointment_id, third_party_id)
  where status = 'pending' and appointment_id is not null;
select public.grant_data_api('public.third_party_charges');

alter table public.third_party_charges enable row level security;
create policy "staff select third_party_charges" on public.third_party_charges for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));
create policy "staff insert third_party_charges" on public.third_party_charges for insert
  with check (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and public.has_permission(account_id, 'billing_access')
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = third_party_charges.account_id)
    and exists (select 1 from public.third_parties tp where tp.id = third_party_id and tp.account_id = third_party_charges.account_id)
  );
-- Voiding one is editing a charge, under the same rule as the invoice it sits
-- beside.
create policy "staff update third_party_charges" on public.third_party_charges for update
  using (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and (public.has_permission(account_id, 'financials_edit_all')
         or (public.has_permission(account_id, 'financials_edit_same_day_only') and created_at::date = current_date))
  )
  with check (
    public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
    and (public.has_permission(account_id, 'financials_edit_all')
         or (public.has_permission(account_id, 'financials_edit_same_day_only') and created_at::date = current_date))
  );
select public.require_two_factor_on('public.third_party_charges');

-- ---------------------------------------------------------------------
-- What a third party paid
-- ---------------------------------------------------------------------
-- A remittance: one transfer from the mutua, spread over the visits it pays
-- for. Not a `payments` row -- that table is the patient's money, and its
-- patient_id is required for that reason.
create table public.third_party_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  third_party_id uuid not null references public.third_parties(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  received_on date not null default current_date,
  method text not null default 'transfer' check (method in ('transfer', 'card', 'cash', 'cheque', 'other')),
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null
);
create index third_party_payments_third_party_idx on public.third_party_payments (third_party_id, received_on);
select public.grant_data_api('public.third_party_payments');

alter table public.third_party_payments enable row level security;
create policy "staff select third_party_payments" on public.third_party_payments for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_access'));
create policy "staff manage third_party_payments" on public.third_party_payments for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'payments_allocate'))
  with check (
    public.is_account_member(account_id) and public.has_permission(account_id, 'payments_allocate')
    and exists (select 1 from public.third_parties tp where tp.id = third_party_id and tp.account_id = third_party_payments.account_id)
  );
select public.require_two_factor_on('public.third_party_payments');

create table public.third_party_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  payment_id uuid not null references public.third_party_payments(id) on delete cascade,
  charge_id uuid not null references public.third_party_charges(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  constraint third_party_payment_allocations_pair unique (payment_id, charge_id)
);
create index third_party_payment_allocations_charge_idx on public.third_party_payment_allocations (charge_id);
select public.grant_data_api('public.third_party_payment_allocations');

alter table public.third_party_payment_allocations enable row level security;
create policy "staff select third_party_payment_allocations" on public.third_party_payment_allocations for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_access'));
create policy "staff manage third_party_payment_allocations" on public.third_party_payment_allocations for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'payments_allocate'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'payments_allocate'));
select public.require_two_factor_on('public.third_party_payment_allocations');

-- An allocation never pays more than the charge is for, nor spends more than
-- the payment brought in, and only ever matches a payment to a live charge of
-- the same third party. Checked against the tables, not the request, so two
-- screens allocating at once cannot overshoot between them.
create or replace function public.third_party_allocation_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge public.third_party_charges%rowtype;
  v_payment public.third_party_payments%rowtype;
begin
  select * into v_charge from public.third_party_charges where id = new.charge_id for update;
  select * into v_payment from public.third_party_payments where id = new.payment_id for update;
  if v_charge.account_id <> new.account_id or v_payment.account_id <> new.account_id
     or v_charge.third_party_id <> v_payment.third_party_id then
    raise exception 'A payment can only settle charges of the same third party' using errcode = 'check_violation';
  end if;
  if v_charge.status = 'void' then
    raise exception 'That charge has been voided' using errcode = 'check_violation';
  end if;
  if (select sum(amount_cents) from public.third_party_payment_allocations where charge_id = new.charge_id) > v_charge.amount_cents then
    raise exception 'More than the charge is for' using errcode = 'check_violation';
  end if;
  if (select sum(amount_cents) from public.third_party_payment_allocations where payment_id = new.payment_id) > v_payment.amount_cents then
    raise exception 'More than the payment brought in' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke execute on function public.third_party_allocation_check() from public, anon, authenticated;
create trigger third_party_allocation_check
  after insert or update on public.third_party_payment_allocations
  for each row execute function public.third_party_allocation_check();

-- And the other way round: a charge something was paid against is not voided
-- or shrunk below it, and a payment is not shrunk below what it settled.
create or replace function public.third_party_charge_keeps_its_allocations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated bigint;
begin
  select coalesce(sum(amount_cents), 0) into v_allocated from public.third_party_payment_allocations where charge_id = new.id;
  if v_allocated > 0 and (new.status = 'void' or new.amount_cents < v_allocated) then
    raise exception 'A payment from the third party is allocated to this charge' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.third_party_charge_keeps_its_allocations() from public, anon, authenticated;
create trigger third_party_charge_keeps_its_allocations
  before update of status, amount_cents on public.third_party_charges
  for each row execute function public.third_party_charge_keeps_its_allocations();

create or replace function public.third_party_payment_covers_its_allocations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_cents < (select coalesce(sum(amount_cents), 0) from public.third_party_payment_allocations where payment_id = new.id) then
    raise exception 'This payment is already allocated beyond that amount' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.third_party_payment_covers_its_allocations() from public, anon, authenticated;
create trigger third_party_payment_covers_its_allocations
  before update of amount_cents on public.third_party_payments
  for each row execute function public.third_party_payment_covers_its_allocations();

-- A visit whose receipt is voided or deleted -- undo_visit, the Billing tab's
-- void, a deleted receipt -- did not happen as billed, so the third party's
-- share of it goes too. Only while nothing has been paid against it: money
-- the mutua already sent for that visit is for a person to sort out, and the
-- charge stays to say so.
--
-- BEFORE DELETE because invoice_id is `on delete set null`, and that action
-- runs ahead of any AFTER trigger here, leaving nothing to find the charge by.
create or replace function public.invoices_void_third_party_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (old.status is distinct from 'void' and new.status = 'void') then
    return new;
  end if;
  update public.third_party_charges c
     set status = 'void', voided_at = now()
   where c.invoice_id = old.id
     and c.status = 'pending'
     and not exists (select 1 from public.third_party_payment_allocations a where a.charge_id = c.id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.invoices_void_third_party_charges() from public, anon, authenticated;
create trigger invoices_void_third_party_charges_on_void
  after update of status on public.invoices
  for each row execute function public.invoices_void_third_party_charges();
create trigger invoices_void_third_party_charges_on_delete
  before delete on public.invoices
  for each row execute function public.invoices_void_third_party_charges();

-- ---------------------------------------------------------------------
-- Charging a visit to a third party
-- ---------------------------------------------------------------------
-- One transaction for the two halves. Done from the browser as two writes, a
-- failure between them leaves the patient's receipt cut to the copago with
-- nothing owed by anyone for the rest -- money that silently stops existing.
--
-- The visit's own line on its receipt becomes the patient's share, renamed so
-- the receipt says who pays the rest; extras added to the receipt stay the
-- patient's. A receipt with payments against it is not rewritten: the
-- patient has already paid for the visit as billed.
--
-- Security invoker: every write below is the caller's own, under the
-- policies above and the invoices' own.
create or replace function public.charge_visit_to_third_party(
  p_appointment_id uuid,
  p_third_party_id uuid,
  p_third_party_cents integer,
  p_patient_cents integer,
  p_patient_third_party_id uuid default null,
  p_list_price_cents integer default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_appt record;
  v_tp third_parties%rowtype;
  v_link patient_third_parties%rowtype;
  v_invoice invoices%rowtype;
  v_line invoice_line_items%rowtype;
  v_lines int;
  v_number text;
  v_charge_id uuid;
  v_team_member uuid;
begin
  if coalesce(p_third_party_cents, 0) <= 0 then
    raise exception 'The third party''s share must be more than zero' using errcode = 'check_violation';
  end if;
  if coalesce(p_patient_cents, -1) < 0 then
    raise exception 'The patient''s share cannot be negative' using errcode = 'check_violation';
  end if;

  select a.id, a.account_id, a.patient_id, a.starts_at, at.name as type_name, coalesce(c.timezone, 'Europe/Madrid') as tz
    into v_appt
    from appointments a
    left join appointment_types at on at.id = a.appointment_type_id
    left join clinics c on c.id = a.clinic_id
   where a.id = p_appointment_id;
  if v_appt.id is null then
    raise exception 'Appointment not found' using errcode = 'no_data_found';
  end if;

  select * into v_tp from third_parties where id = p_third_party_id and account_id = v_appt.account_id;
  if v_tp.id is null then
    raise exception 'Third party not found' using errcode = 'no_data_found';
  end if;
  if p_patient_third_party_id is not null then
    select * into v_link from patient_third_parties
     where id = p_patient_third_party_id and patient_id = v_appt.patient_id and third_party_id = v_tp.id;
    if v_link.id is null then
      raise exception 'That cover is not this patient''s with this third party' using errcode = 'check_violation';
    end if;
  end if;
  if exists (select 1 from third_party_charges where appointment_id = p_appointment_id and status = 'pending') then
    raise exception 'This visit is already charged to a third party' using errcode = 'unique_violation';
  end if;

  -- The receipt reception would act on, chosen as useVisitCharging's
  -- findInvoice chooses it: not void, not a refund, open before settled,
  -- newest first.
  select * into v_invoice from invoices
   where appointment_id = p_appointment_id and status <> 'void' and not coalesce(is_refund, false)
   order by (status <> 'paid') desc, created_at desc
   limit 1;

  if v_invoice.id is not null then
    if v_invoice.status <> 'unpaid' or exists (select 1 from payments where invoice_id = v_invoice.id) then
      raise exception 'This visit''s receipt already has payments against it' using errcode = 'check_violation';
    end if;
    select count(*) into v_lines from invoice_line_items
     where invoice_id = v_invoice.id and service_id is null and package_purchase_id is null;
    if v_lines <> 1 then
      raise exception 'Cannot tell which line on the receipt is the visit' using errcode = 'check_violation';
    end if;
    select * into v_line from invoice_line_items
     where invoice_id = v_invoice.id and service_id is null and package_purchase_id is null;
  else
    v_number := next_invoice_number(v_appt.account_id);
    insert into invoices (account_id, patient_id, appointment_id, invoice_number, status, total_cents)
    values (v_appt.account_id, v_appt.patient_id, p_appointment_id, v_number, 'unpaid', 0)
    returning * into v_invoice;
    insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
    values (v_appt.account_id, v_invoice.id, coalesce(v_appt.type_name, 'Cita'), 1, coalesce(p_list_price_cents, 0))
    returning * into v_line;
  end if;

  update invoice_line_items
     set price_cents = p_patient_cents,
         quantity = 1,
         description = v_line.description || case when p_patient_cents > 0 then ' · copago ' else ' · a cargo de ' end || v_tp.name
   where id = v_line.id;
  update invoices i
     set total_cents = (select coalesce(sum(l.price_cents * l.quantity), 0) from invoice_line_items l where l.invoice_id = i.id)
   where i.id = v_invoice.id;

  select id into v_team_member from team_members
   where account_id = v_appt.account_id and user_id = (select auth.uid()) and deleted_at is null
   limit 1;

  insert into third_party_charges (
    account_id, third_party_id, patient_id, patient_third_party_id, appointment_id, invoice_id, invoice_line_item_id,
    list_price_cents, line_description, service_date, description, amount_cents, policy_number, authorization_number, created_by
  ) values (
    v_appt.account_id, v_tp.id, v_appt.patient_id, v_link.id, p_appointment_id, v_invoice.id, v_line.id,
    v_line.price_cents * v_line.quantity, v_line.description, (v_appt.starts_at at time zone v_appt.tz)::date,
    v_line.description, p_third_party_cents, v_link.policy_number, v_link.authorization_number, v_team_member
  )
  returning id into v_charge_id;

  return jsonb_build_object('invoice_id', v_invoice.id, 'charge_id', v_charge_id);
end;
$$;
revoke all on function public.charge_visit_to_third_party(uuid, uuid, integer, integer, uuid, integer) from public, anon;
grant execute on function public.charge_visit_to_third_party(uuid, uuid, integer, integer, uuid, integer) to authenticated;

-- Taking the third party off a visit: the charge is voided and the patient's
-- line goes back to what it said before, so the patient owes the visit as
-- if it had never been split. Refused once the third party has paid any of it.
create or replace function public.remove_third_party_charge(p_charge_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_charge third_party_charges%rowtype;
begin
  select * into v_charge from third_party_charges where id = p_charge_id for update;
  if v_charge.id is null or v_charge.status = 'void' then
    raise exception 'Charge not found' using errcode = 'no_data_found';
  end if;
  -- The trigger refuses this too; said here in words reception can act on.
  if exists (select 1 from third_party_payment_allocations where charge_id = p_charge_id) then
    raise exception 'The third party has already paid part of this visit' using errcode = 'check_violation';
  end if;

  update third_party_charges set status = 'void', voided_at = now() where id = p_charge_id;

  if v_charge.invoice_line_item_id is not null and v_charge.list_price_cents is not null then
    update invoice_line_items
       set price_cents = v_charge.list_price_cents, quantity = 1, description = coalesce(v_charge.line_description, description)
     where id = v_charge.invoice_line_item_id;
    update invoices i
       set total_cents = t.total,
           status = case
             when i.status = 'void' then 'void'
             when (select coalesce(sum(p.amount_cents), 0) from payments p where p.invoice_id = i.id) >= t.total then 'paid'
             else 'unpaid'
           end
      from (select coalesce(sum(l.price_cents * l.quantity), 0) as total from invoice_line_items l where l.invoice_id = v_charge.invoice_id) t
     where i.id = v_charge.invoice_id;
  end if;
end;
$$;
revoke all on function public.remove_third_party_charge(uuid) from public, anon;
grant execute on function public.remove_third_party_charge(uuid) to authenticated;

-- A payment and where it goes, in one transaction: a remittance recorded with
-- half its allocations is a mutua that reads as owing what it has paid.
-- p_allocations: [{"charge_id": uuid, "amount_cents": int}, ...]
create or replace function public.record_third_party_payment(
  p_third_party_id uuid,
  p_amount_cents integer,
  p_received_on date,
  p_method text,
  p_reference text,
  p_notes text,
  p_allocations jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_tp third_parties%rowtype;
  v_payment_id uuid;
begin
  select * into v_tp from third_parties where id = p_third_party_id;
  if v_tp.id is null then
    raise exception 'Third party not found' using errcode = 'no_data_found';
  end if;

  insert into third_party_payments (account_id, third_party_id, amount_cents, received_on, method, reference, notes, created_by)
  values (
    v_tp.account_id, v_tp.id, p_amount_cents, coalesce(p_received_on, current_date), coalesce(p_method, 'transfer'),
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    (select id from team_members where account_id = v_tp.account_id and user_id = (select auth.uid()) and deleted_at is null limit 1)
  )
  returning id into v_payment_id;

  insert into third_party_payment_allocations (account_id, payment_id, charge_id, amount_cents)
  select v_tp.account_id, v_payment_id, (a ->> 'charge_id')::uuid, (a ->> 'amount_cents')::int
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
   where (a ->> 'amount_cents')::int > 0;

  return v_payment_id;
end;
$$;
revoke all on function public.record_third_party_payment(uuid, integer, date, text, text, text, jsonb) from public, anon;
grant execute on function public.record_third_party_payment(uuid, integer, date, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
-- Read-and-append, as 20261022173310 does, so this keeps whatever types other
-- migrations have added whichever order they apply in.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array[
    'third_party', 'third_party_rate', 'patient_third_party', 'third_party_charge', 'third_party_payment', 'third_party_allocation'
  ]) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_third_parties after insert or update or delete on public.third_parties
  for each row execute function public.fn_audit_log('third_party');
create trigger trg_audit_third_party_rates after insert or update or delete on public.third_party_rates
  for each row execute function public.fn_audit_log('third_party_rate');
create trigger trg_audit_patient_third_parties after insert or update or delete on public.patient_third_parties
  for each row execute function public.fn_audit_log('patient_third_party');
create trigger trg_audit_third_party_charges after insert or update or delete on public.third_party_charges
  for each row execute function public.fn_audit_log('third_party_charge');
create trigger trg_audit_third_party_payments after insert or update or delete on public.third_party_payments
  for each row execute function public.fn_audit_log('third_party_payment');
create trigger trg_audit_third_party_payment_allocations after insert or update or delete on public.third_party_payment_allocations
  for each row execute function public.fn_audit_log('third_party_allocation');

-- ---------------------------------------------------------------------
-- Anonymisation
-- ---------------------------------------------------------------------
-- The policy and authorisation numbers are the person's; the charges are the
-- clinic's money and stay, as invoices and payments do, without them. A
-- trigger on anonymized_at rather than another restatement of
-- anonymize_patient, the way patient_relations does it (20261021171628):
-- that function runs this by setting the column.
create or replace function public.patients_drop_third_parties_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    update public.third_party_charges set policy_number = null, authorization_number = null
     where patient_id = new.id and (policy_number is not null or authorization_number is not null);
    delete from public.patient_third_parties where patient_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.patients_drop_third_parties_on_anonymize() from public, anon, authenticated;
create trigger patients_drop_third_parties_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_third_parties_on_anonymize();

-- ---------------------------------------------------------------------
-- merge_patients moves them (CLAUDE.md)
-- ---------------------------------------------------------------------
-- Restated from main's latest definition (20261021173018_facturas_to_the_tutor)
-- with one block added after the facturas addressed to a tutor.
create or replace function merge_patients(p_survivor_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_dup_account_id uuid;
  v_moved jsonb := '{}'::jsonb;
  v_count int;
  v_dup_external_reference text;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'Cannot merge a patient into itself';
  end if;

  select account_id into v_account_id from patients where id = p_survivor_id;
  select account_id into v_dup_account_id from patients where id = p_duplicate_id;

  if v_account_id is null or v_dup_account_id is null then
    raise exception 'Both patients must exist';
  end if;
  -- Never merge across accounts: that would move one clinic's clinical and
  -- financial records into another's.
  if v_account_id <> v_dup_account_id then
    raise exception 'Both patients must belong to the same account';
  end if;
  if not is_account_member(v_account_id) then
    raise exception 'Not a member of this account';
  end if;
  if not has_permission(v_account_id, 'patients_delete_merge') then
    raise exception 'Missing permission: patients_delete_merge';
  end if;

  -- Ownership of bonos moves first, so the share cleanup below can see which
  -- bonos the survivor ends up owning.
  update package_purchases set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchases', v_count);

  -- `package_purchase_shares` is unique on (package_purchase_id, patient_id),
  -- and two rows of the duplicate's would now violate it or be meaningless:
  -- a bono the survivor already shares, and a bono the survivor now owns
  -- outright (you do not share a bono with yourself). Drop those, move the
  -- rest.
  delete from package_purchase_shares s
  where s.patient_id = p_duplicate_id
    and (
      exists (select 1 from package_purchase_shares o
               where o.package_purchase_id = s.package_purchase_id and o.patient_id = p_survivor_id)
      or exists (select 1 from package_purchases pp
                  where pp.id = s.package_purchase_id and pp.patient_id = p_survivor_id)
    );
  update package_purchase_shares set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchase_shares', v_count);

  -- Stripe allows one customer per patient per account. If the survivor
  -- already has one, keep it -- it is the one any saved card and active
  -- payment schedule is attached to -- and let the duplicate's row go.
  if exists (select 1 from patient_stripe_customers where patient_id = p_survivor_id and account_id = v_account_id) then
    delete from patient_stripe_customers where patient_id = p_duplicate_id;
  else
    update patient_stripe_customers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  end if;

  update account_credits set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('account_credits', v_count);

  update appointments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('appointments', v_count);

  update invoices set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('invoices', v_count);

  -- The money itself. `payments.patient_id` is `on delete cascade`, so before
  -- this line the delete at the end of the function destroyed every payment
  -- the duplicate held -- silently, and after reporting the merge a success.
  update payments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('payments', v_count);

  -- Facturas follow their payments onto the survivor. No huella is affected:
  -- the patient is not one of the hashed fields, and factura_records is keyed
  -- by factura, not by patient.
  update facturas set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas', v_count);

  update package_sessions set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_sessions', v_count);

  update care_plans set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_exercises set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_push_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update contact_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_app_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_contact_numbers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_memberships set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update payment_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update photo_upload_tokens set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update waitlist_entries set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update whatsapp_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- Automation runs follow the person: a patient halfway through a follow-up
  -- sequence carries on from where they were, on the surviving record, rather
  -- than having the run (and its history) cascade away with the duplicate.
  update automation_sequence_runs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('automation_sequence_runs', v_count);

  -- Mi día tasks an automation left about this person stay with the person.
  update staff_tasks set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('staff_tasks', v_count);

  -- The birthday guard is unique per (rule, patient, day). A day both records
  -- were already greeted on keeps the survivor's row; the rest move, so a
  -- merge on someone's birthday does not greet them a second time.
  delete from automation_birthday_sends d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from automation_birthday_sends s
                  where s.patient_id = p_survivor_id and s.rule_id = d.rule_id and s.local_date = d.local_date);
  update automation_birthday_sends set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- These three are `on delete set null`, so they outlive the duplicate
  -- either way -- but with the link to the person cut. A lead that converted
  -- would stop knowing which patient it became, and a review request would
  -- stop knowing who it was sent to. Same reasoning as whatsapp_messages
  -- above, which has always been moved despite being set null too.
  update email_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update leads set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update review_requests set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  update patient_docs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_docs', v_count);

  update patient_files set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_files', v_count);

  update posture_assessments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('posture_assessments', v_count);

  -- learn_sends arrives in its own migration, which redefines this function
  -- too; whichever lands second keeps both by naming the other's table only
  -- once it exists.
  if to_regclass('public.learn_sends') is not null then
    execute 'update public.learn_sends set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('learn_sends', v_count);
  end if;

  -- Other patients pointing AT the duplicate -- a child whose tutor is the
  -- duplicate record, someone the duplicate referred. These FKs are
  -- `on delete set null`, so leaving them would silently orphan a minor's
  -- tutor link. Repoint them, except where that would make the survivor its
  -- own tutor or its own referrer.
  update patients set tutor_patient_id = p_survivor_id
   where tutor_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set tutor_patient_id = null
   where id = p_survivor_id and tutor_patient_id = p_duplicate_id;
  update patients set referred_by_patient_id = p_survivor_id
   where referred_by_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set referred_by_patient_id = null
   where id = p_survivor_id and referred_by_patient_id = p_duplicate_id;

  -- Family links (patient_relations, 20261021171628), stored both ways. The
  -- duplicate's become the survivor's: a link between the two records
  -- themselves goes, and so does one the survivor already has to the same
  -- person, which the unique pair would refuse.
  delete from patient_relations
   where (patient_id = p_duplicate_id and related_patient_id = p_survivor_id)
      or (patient_id = p_survivor_id and related_patient_id = p_duplicate_id);
  delete from patient_relations d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.patient_id = p_survivor_id and s.related_patient_id = d.related_patient_id);
  delete from patient_relations d
   where d.related_patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.related_patient_id = p_survivor_id and s.patient_id = d.patient_id);
  update patient_relations set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_relations', v_count);
  update patient_relations set related_patient_id = p_survivor_id where related_patient_id = p_duplicate_id;

  -- Facturas addressed to the duplicate as a minor's tutor (recipient_patient_id,
  -- 20261021173018) are addressed to the survivor. Not a foreign key, so
  -- nothing would have stopped the delete below from leaving them pointing at
  -- a record that no longer exists.
  update facturas set recipient_patient_id = p_survivor_id where recipient_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas_addressed', v_count);

  -- Third-party cover and what third parties owe for the duplicate's visits
  -- (20261022201348). The charges are RESTRICT, so leaving them here would
  -- fail the delete below rather than lose them; the cover would cascade.
  update patient_third_parties set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_third_parties', v_count);
  update third_party_charges set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('third_party_charges', v_count);

  -- external_reference is unique per account (patients_external_reference_uniq)
  -- and the duplicate is only deleted at the end, so copying its reference
  -- onto the survivor below collided with the duplicate's own copy. That is
  -- the commonest pair there is -- a record made at the front desk and the
  -- PracticeHub import of the same person -- and the merge refused it with
  -- "duplicate key value". Take the reference off the duplicate first; the
  -- field merge reads it from here instead.
  select external_reference into v_dup_external_reference from patients where id = p_duplicate_id;
  if v_dup_external_reference is not null then
    update patients set external_reference = null where id = p_duplicate_id;
  end if;

  -- Field-level merge: the survivor keeps everything it already has, and only
  -- its blanks are filled from the duplicate. That is the direction that can
  -- never lose data the front desk deliberately typed -- picking the
  -- duplicate's value over a populated one would.
  --
  -- Arrays are unioned rather than replaced: a VIP tag or a marketing opt-in
  -- on either record belongs to the person, not to the row.
  --
  -- balance_cents is summed. It is not a live ledger -- it is the account
  -- balance written once at PracticeHub import (patient_live_balances is the
  -- computed one) -- so for two halves of one person the snapshot is the sum.
  update patients s set
    last_name              = coalesce(nullif(s.last_name, ''), d.last_name),
    date_of_birth          = coalesce(s.date_of_birth, d.date_of_birth),
    email                  = coalesce(nullif(s.email, ''), d.email),
    occupation             = coalesce(nullif(s.occupation, ''), d.occupation),
    emergency_contact      = coalesce(nullif(s.emergency_contact, ''), d.emergency_contact),
    referral_source        = coalesce(nullif(s.referral_source, ''), d.referral_source),
    notes                  = coalesce(nullif(s.notes, ''), d.notes),
    external_reference     = coalesce(nullif(s.external_reference, ''), v_dup_external_reference),
    address                = coalesce(nullif(s.address, ''), d.address),
    national_id            = coalesce(nullif(s.national_id, ''), d.national_id),
    sticky_note            = coalesce(nullif(s.sticky_note, ''), d.sticky_note),
    gender                 = coalesce(nullif(s.gender, ''), d.gender),
    chief_complaint        = coalesce(nullif(s.chief_complaint, ''), d.chief_complaint),
    red_flags              = coalesce(nullif(s.red_flags, ''), d.red_flags),
    yellow_flags           = coalesce(nullif(s.yellow_flags, ''), d.yellow_flags),
    diagnosis              = coalesce(nullif(s.diagnosis, ''), d.diagnosis),
    goals                  = coalesce(nullif(s.goals, ''), d.goals),
    postal_code            = coalesce(nullif(s.postal_code, ''), d.postal_code),
    city                   = coalesce(nullif(s.city, ''), d.city),
    country                = coalesce(nullif(s.country, ''), d.country),
    photo_storage_path     = coalesce(nullif(s.photo_storage_path, ''), d.photo_storage_path),
    clinic_id              = coalesce(s.clinic_id, d.clinic_id),
    default_practitioner_id = coalesce(s.default_practitioner_id, d.default_practitioner_id),
    user_id                = coalesce(s.user_id, d.user_id),
    tags                   = (select coalesce(array_agg(distinct x), '{}') from unnest(s.tags || d.tags) x),
    marketing_channels     = (select coalesce(array_agg(distinct x), '{}') from unnest(s.marketing_channels || d.marketing_channels) x),
    -- Who may be contacted, and through whom, belongs to the person: if
    -- either record says minor, the merged one does, and keeps the tutor its
    -- messages go to. Before this a child flagged minor on the record that
    -- was deleted became directly contactable. Never the patient's own tutor
    -- or referrer: the duplicate may point at the survivor.
    is_minor               = s.is_minor or d.is_minor,
    tutor_patient_id       = coalesce(s.tutor_patient_id,
                                      nullif(nullif(d.tutor_patient_id, p_survivor_id), p_duplicate_id)),
    referred_by_patient_id = coalesce(s.referred_by_patient_id,
                                      nullif(nullif(d.referred_by_patient_id, p_survivor_id), p_duplicate_id)),
    app_push_opted_out     = s.app_push_opted_out or d.app_push_opted_out,
    has_phone              = s.has_phone or d.has_phone,
    do_not_contact         = s.do_not_contact or d.do_not_contact,
    balance_cents          = s.balance_cents + d.balance_cents
  from patients d
  where s.id = p_survivor_id and d.id = p_duplicate_id;

  -- Every table keyed off the duplicate has been moved above, so the cascade
  -- has nothing left to take. That sentence was already here and was wrong
  -- for payments; the guard below is what makes it checkable rather than
  -- merely intended.
  --
  -- A table added to `patients` in future and forgotten here lands in exactly
  -- the same trap, and the next one may be as quiet as payments was. RESTRICT
  -- on facturas turns the fiscal case into a loud failure; this turns the
  -- money case into one too, at the cost of one count.
  if exists (select 1 from payments where patient_id = p_duplicate_id) then
    raise exception 'merge_patients would have deleted payments still on the duplicate record (patient %)', p_duplicate_id
      using errcode = 'restrict_violation';
  end if;

  delete from patients where id = p_duplicate_id;

  return v_moved;
end;
$$;
