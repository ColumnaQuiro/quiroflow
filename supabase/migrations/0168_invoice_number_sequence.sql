-- Stop invoice numbers being handed out twice.
--
-- Every place that raises an invoice numbered it the same way:
--
--   const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
--   const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
--
-- A count is not a sequence. It goes DOWN when an invoice is deleted, and
-- invoices are deleted -- usePackageSession() removes the one raised against
-- a visit that turns out to be covered by a bono. So the next invoice is
-- issued the number that was just freed, and two different patients end up
-- holding the same one.
--
-- Seven numbers on the live account are currently used twice: INV-3260,
-- 3263, 3290, 3291, 3292, 3302 and 3388. They are minutes to over an hour
-- apart -- 3290's two invoices are 91 minutes apart -- which rules out
-- concurrent writes and points squarely at the delete-then-reuse path.
-- Under AEAT invoice numbering has to be sequential and unrepeated, so this
-- is a compliance defect, not just an inconvenience.
--
-- The counter below only ever moves forward. It is per account and per
-- series, and is seeded above every number that series has already issued,
-- so no new invoice can collide with an old one -- including with either
-- half of the seven existing pairs, which are left exactly as they are.
-- Renumbering an already-issued invoice is itself not something to do
-- quietly, and is a separate decision.
--
-- Two series exist today, both in the invoices table: INV- for invoices and
-- REF- for refunds (is_refund, negative total). They counted off the same
-- undifferentiated `select count(*) from invoices`, so raising a refund also
-- consumed an invoice number and vice versa. Here they are separate
-- counters, which is what a credit-note series is supposed to be.

create table invoice_number_sequences (
  account_id uuid not null references accounts(id) on delete cascade,
  prefix text not null,
  next_number bigint not null check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, prefix)
);

alter table invoice_number_sequences enable row level security;

-- No policies: the table is reached only through next_invoice_number()
-- below, which is security definer. Nothing should read or write it
-- directly, and without a policy nothing but the service role can.
comment on table invoice_number_sequences is
  'Per-account, per-series monotonic counter behind next_invoice_number(). Never decreases; not to be edited by hand.';

-- Seed each series past everything it has already issued. Only our own
-- <PREFIX><digits> numbers count: imported PracticeHub invoices carry their
-- own reference formats (PH-...), and 3,320 of the 3,455 rows on the live
-- account are one of those. Letting those set the counter would push it into
-- a range that never belonged to these series.
insert into invoice_number_sequences (account_id, prefix, next_number)
select account_id,
       substring(invoice_number from '^(INV-|REF-)'),
       max(substring(invoice_number from '^(?:INV-|REF-)(\d+)$')::bigint) + 1
from invoices
where invoice_number ~ '^(INV-|REF-)\d+$'
group by 1, 2;

-- Hands out the next number in a series, atomically: the upsert takes a row
-- lock, so two concurrent callers serialize and get different numbers rather
-- than both reading the same value.
--
-- Padding to 4 digits keeps INV-0001..INV-9999 lining up with what the
-- clinic already has; past that it simply grows a digit rather than wrapping
-- or truncating.
create or replace function next_invoice_number(p_account_id uuid, p_prefix text default 'INV-')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  -- security definer, so membership is checked here rather than by RLS.
  -- auth.uid() is null for the service role (the Stripe webhook raises
  -- invoices with no user in the request), and execute is not granted to
  -- anon, so a null uid here means a trusted server-side caller.
  if auth.uid() is not null and not is_account_member(p_account_id) then
    raise exception 'Not a member of this account';
  end if;

  -- The prefix names a legal numbering series, so it is an allowlist rather
  -- than free text: a typo must not silently open a third series.
  if p_prefix not in ('INV-', 'REF-') then
    raise exception 'Unknown invoice series: %', p_prefix;
  end if;

  -- next_number always names the number to hand out NEXT, so the value
  -- allocated by this call is the post-write value minus one -- 1 on the
  -- insert path (2 - 1), the previous next_number on the update path.
  insert into invoice_number_sequences (account_id, prefix, next_number)
  values (p_account_id, p_prefix, 2)
  on conflict (account_id, prefix) do update
    set next_number = invoice_number_sequences.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_number;

  return p_prefix || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function next_invoice_number(uuid, text) from public;
grant execute on function next_invoice_number(uuid, text) to authenticated, service_role;
