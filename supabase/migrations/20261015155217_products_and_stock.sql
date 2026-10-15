-- Products and stock: what a clinic sells over the counter -- a cervical
-- pillow, magnesium, an exercise band -- next to the services it already
-- charges for.
--
-- A product is a services_products row with kind = 'product'. It can carry:
--   stock_units  units on the shelf; null = not counted (made to order)
--   min_stock    below this it shows as "low stock" (My Day, Monday summary)
--   cost_cents   what one unit cost, from the last delivery, for the margin
-- and its own tax_rate (percent). That column existed and was never read: a
-- factura's IVA comes from the account's one rule (utils/facturaTax), which
-- for a physiotherapy clinic is "exempt, art. 20.Uno.3". Goods are not
-- exempt, so a product sale is the one place the product's own rate is used:
-- its factura is issued at 21 / 10 / 4 %, whatever the services are.
--
-- Stock only moves through a movement (product_stock_movements): a delivery
-- received, a sale, or an adjustment with its reason. Nobody writes
-- stock_units directly -- the guard below refuses it -- so the number on the
-- shelf is always the sum of what is in the list.
--
-- A sale is one call (sell_products) and one transaction: the stock is
-- checked and taken, and a paid invoice with its line items and payment is
-- written for each tax rate in the basket (a factura carries one rate). The
-- factura itself is issued afterwards by the server (server/api/products/
-- sell.post.ts), the way every other payment's is -- never blocking it.
--
-- No patient_id here: the sale's patient is on its invoice and payment,
-- which merge_patients already moves.

alter table public.services_products
  add column kind text not null default 'service' check (kind in ('service', 'product')),
  add column stock_units integer check (stock_units >= 0),
  add column min_stock integer check (min_stock >= 0),
  add column cost_cents integer check (cost_cents >= 0),
  -- Goods are taxed: a product's factura needs a real rate (the AEAT has no
  -- "0 % and not exempt" for these).
  add constraint services_products_product_tax_rate check (kind <> 'product' or tax_rate in (4, 10, 21));

create table public.product_stock_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  product_id uuid not null references public.services_products(id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('receive', 'sale', 'adjust')),
  reason text,
  unit_cost_cents integer check (unit_cost_cents >= 0),
  supplier text,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'adjust' or length(btrim(coalesce(reason, ''))) > 0)
);
create index product_stock_movements_product on public.product_stock_movements (product_id, created_at desc);
create index product_stock_movements_account on public.product_stock_movements (account_id, created_at desc);
create index product_stock_movements_invoice on public.product_stock_movements (invoice_id) where invoice_id is not null;

alter table public.product_stock_movements enable row level security;
-- Whoever can sell (billing_access) or set up the catalogue (billing_config)
-- reads the history. Writes only through the functions below.
create policy "staff select product_stock_movements" on public.product_stock_movements
  for select using (
    public.is_account_member(account_id)
    and (public.has_permission(account_id, 'billing_access') or public.has_permission(account_id, 'billing_config'))
  );
select public.require_two_factor_on('public.product_stock_movements');

-- Selling needs to read the catalogue: billing_access may read
-- services_products (it could already, through invoice lines; the manage
-- policy covers billing_config's writes).
create policy "sellers select services_products" on public.services_products
  for select using (public.is_account_member(account_id) and public.has_permission(account_id, 'billing_access'));

-- stock_units moves only with a movement. Turning counting on or off at zero
-- (null <-> 0) is a catalogue edit, not a stock change.
create or replace function public.guard_services_products_stock()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if auth.uid() is null or current_setting('quiroflow.stock_write', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.stock_units, 0) <> 0 then
      raise exception 'Stock starts at zero: receive a delivery to add units' using errcode = '42501';
    end if;
  elsif new.stock_units is distinct from old.stock_units
        and not (coalesce(new.stock_units, 0) = 0 and coalesce(old.stock_units, 0) = 0) then
    raise exception 'Stock changes through a delivery, a sale or an adjustment' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger services_products_guard_stock before insert or update on public.services_products
  for each row execute function public.guard_services_products_stock();

-- A delivery received (+units, optionally its unit cost and supplier) or an
-- adjustment (+/- units, with a reason: broken, expired, counted).
create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_delta integer,
  p_kind text,
  p_reason text default null,
  p_unit_cost_cents integer default null,
  p_supplier text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_product services_products;
  v_member uuid;
  v_new integer;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_product from services_products where id = p_product_id for update;
  if v_product.id is null or v_product.kind <> 'product' then
    raise exception 'No such product' using errcode = '22023';
  end if;
  if not public.is_account_member(v_product.account_id)
     or not (public.has_permission(v_product.account_id, 'billing_access') or public.has_permission(v_product.account_id, 'billing_config')) then
    raise exception 'Your role cannot change stock' using errcode = '42501';
  end if;
  if p_kind not in ('receive', 'adjust') or coalesce(p_delta, 0) = 0 then
    raise exception 'Say how many units' using errcode = '22023';
  end if;
  if p_kind = 'receive' and p_delta < 0 then
    raise exception 'A delivery adds units' using errcode = '22023';
  end if;
  if p_kind = 'adjust' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the stock is being adjusted' using errcode = '22023';
  end if;
  v_new := coalesce(v_product.stock_units, 0) + p_delta;
  if v_new < 0 then
    raise exception 'Only % in stock', coalesce(v_product.stock_units, 0) using errcode = '22023';
  end if;

  select tm.id into v_member from team_members tm
  where tm.account_id = v_product.account_id and tm.user_id = auth.uid() and tm.deleted_at is null;

  perform set_config('quiroflow.stock_write', 'on', true);
  update services_products
  set stock_units = v_new,
      cost_cents = case when p_kind = 'receive' and p_unit_cost_cents is not null then p_unit_cost_cents else cost_cents end
  where id = p_product_id;
  perform set_config('quiroflow.stock_write', 'off', true);

  insert into product_stock_movements (account_id, product_id, delta, kind, reason, unit_cost_cents, supplier, created_by)
  values (v_product.account_id, p_product_id, p_delta, p_kind, nullif(btrim(coalesce(p_reason, '')), ''), p_unit_cost_cents, nullif(btrim(coalesce(p_supplier, '')), ''), v_member);
  return v_new;
end;
$$;
revoke all on function public.adjust_product_stock(uuid, integer, text, text, integer, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, integer, text, text, integer, text) to authenticated;

-- One sale: p_items is [{ "product_id": uuid, "quantity": int }, ...].
-- Returns one row per invoice written (one per tax rate), for the facturas.
create or replace function public.sell_products(p_patient_id uuid, p_items jsonb, p_method text)
returns table (invoice_id uuid, payment_id uuid, amount_cents integer, tax_rate_bp integer, description text)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_account uuid;
  v_member uuid;
  v_rate integer;
  v_number text;
  v_invoice uuid;
  v_payment uuid;
  v_total integer;
  v_desc text;
  r record;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select account_id into v_account from patients where id = p_patient_id;
  if v_account is null then
    raise exception 'No such patient' using errcode = '22023';
  end if;
  -- What the RLS on invoices and payments would ask of the caller.
  if not public.is_account_member(v_account)
     or not public.has_permission(v_account, 'billing_access')
     or not exists (select 1 from public.my_permitted_accounts('payments_allocate') a where a = v_account)
     or not public.can_access_patient(v_account, p_patient_id) then
    raise exception 'Your role cannot take payments for this patient' using errcode = '42501';
  end if;
  if coalesce(btrim(p_method), '') = '' or p_method = 'credit' then
    raise exception 'Choose how it is paid' using errcode = '22023';
  end if;

  select tm.id into v_member from team_members tm
  where tm.account_id = v_account and tm.user_id = auth.uid() and tm.deleted_at is null;

  drop table if exists _sale;
  create temp table _sale on commit drop as
  select (i->>'product_id')::uuid as product_id, sum((i->>'quantity')::integer)::integer as quantity
  from jsonb_array_elements(p_items) i
  group by 1;
  if not exists (select 1 from _sale) or exists (select 1 from _sale where quantity is null or quantity <= 0) then
    raise exception 'Nothing to sell' using errcode = '22023';
  end if;

  -- Locked in a fixed order, so two sales of the same products queue rather
  -- than deadlock, and neither can sell the last unit twice.
  perform 1 from services_products p join _sale s on s.product_id = p.id order by p.id for update of p;
  for r in
    select s.product_id, s.quantity, p.name, p.kind, p.account_id, p.stock_units
    from _sale s left join services_products p on p.id = s.product_id
  loop
    if r.name is null or r.kind <> 'product' or r.account_id <> v_account then
      raise exception 'No such product' using errcode = '22023';
    end if;
    if r.stock_units is not null and r.stock_units < r.quantity then
      raise exception 'Only % of % left', r.stock_units, r.name using errcode = '22023';
    end if;
  end loop;

  perform set_config('quiroflow.stock_write', 'on', true);
  for v_rate in
    select distinct round(p.tax_rate * 100)::integer from _sale s join services_products p on p.id = s.product_id order by 1 desc
  loop
    select sum(p.price_cents * s.quantity)::integer,
           string_agg(p.name || case when s.quantity > 1 then ' × ' || s.quantity else '' end, ', ' order by p.name)
    into v_total, v_desc
    from _sale s join services_products p on p.id = s.product_id
    where round(p.tax_rate * 100)::integer = v_rate;

    v_number := public.next_invoice_number(v_account);
    insert into invoices (account_id, patient_id, invoice_number, status, total_cents)
    values (v_account, p_patient_id, v_number, 'paid', v_total)
    returning id into v_invoice;

    insert into invoice_line_items (account_id, invoice_id, service_id, description, quantity, price_cents)
    select v_account, v_invoice, p.id, p.name, s.quantity, p.price_cents
    from _sale s join services_products p on p.id = s.product_id
    where round(p.tax_rate * 100)::integer = v_rate;

    insert into payments (account_id, patient_id, invoice_id, amount_cents, method, purpose, created_by)
    values (v_account, p_patient_id, v_invoice, v_total, p_method, 'visit', v_member)
    returning id into v_payment;

    insert into product_stock_movements (account_id, product_id, delta, kind, invoice_id, created_by)
    select v_account, s.product_id, -s.quantity, 'sale', v_invoice, v_member
    from _sale s join services_products p on p.id = s.product_id
    where round(p.tax_rate * 100)::integer = v_rate;

    update services_products p set stock_units = p.stock_units - s.quantity
    from _sale s
    where p.id = s.product_id and p.stock_units is not null and round(p.tax_rate * 100)::integer = v_rate;

    invoice_id := v_invoice;
    payment_id := v_payment;
    amount_cents := v_total;
    tax_rate_bp := v_rate;
    description := v_desc;
    return next;
  end loop;
  perform set_config('quiroflow.stock_write', 'off', true);
end;
$$;
revoke all on function public.sell_products(uuid, jsonb, text) from public, anon;
grant execute on function public.sell_products(uuid, jsonb, text) to authenticated;
