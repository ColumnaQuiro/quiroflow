-- The payment methods screen has never been wired to anything.
--
-- Settings -> Payment Methods has existed since 0100: staff can add one,
-- deactivate one, delete one. Its own help text invites exactly the thing that
-- prompted this ("add others (e.g. Bank Transfer)"). Nothing reads the table.
-- Every payment dropdown in the app hardcodes its own <option> list, and
-- payments.method is a check constraint naming five fixed strings, so a method
-- added on that screen appears nowhere and cannot be recorded against a
-- payment. Adding "Transferencia bancaria" there today changes nothing.
--
-- Two things were missing underneath it: the table has no stable identifier to
-- write into payments.method (only a display name staff can rename), and
-- nothing seeds it for an account -- 0100 seeded the accounts existing that
-- day and create_account_with_owner was never taught to, so every account
-- created since has an empty screen.

-- ---------------------------------------------------------------------
-- A stable key, separate from the name
--
-- payments.method stores the key. The name is what staff see and may rename
-- freely -- renaming "Card" to "Tarjeta/TPV" must not orphan 2,542 payments.
alter table payment_methods add column key text;
alter table payment_methods add column is_system boolean not null default false;

update payment_methods
set key = case lower(trim(name))
  when 'cash' then 'cash'
  when 'efectivo' then 'cash'
  when 'card' then 'card'
  when 'tarjeta' then 'card'
  else regexp_replace(lower(trim(name)), '[^a-z0-9]+', '_', 'g')
end
where key is null;

-- Two rows whose names collapse to one key (a clinic with "Card" and "card")
-- would break the unique index below, so the later one is suffixed rather than
-- the migration failing.
with dupes as (
  select id, row_number() over (partition by account_id, key order by sort_order, created_at) as rn
  from payment_methods
)
update payment_methods pm set key = pm.key || '_' || d.rn
from dupes d where d.id = pm.id and d.rn > 1;

alter table payment_methods alter column key set not null;
create unique index payment_methods_account_key_uniq on payment_methods (account_id, key);

comment on column payment_methods.key is
  'Stable identifier written to payments.method. Never changes; the name is the editable label.';
comment on column payment_methods.is_system is
  'credit and write_off: these carry behaviour (spending account credit, settling without money) and are not staff-editable.';

-- ---------------------------------------------------------------------
-- The default set, for every account

create or replace function seed_payment_methods(p_account_id uuid)
returns void
language sql
as $$
  -- English, matching what 0100 seeded and what the source language of every
  -- t(en, es) pair in the app is. These names are DATA now, so they cannot be
  -- run through t() -- but the five built-in keys still have translations in
  -- the UI, which uses them until a clinic renames one. Seeding Spanish here
  -- was the first attempt and it showed Spanish to English users, since there
  -- is no longer anything to translate.
  insert into payment_methods (account_id, key, name, sort_order, is_active, is_system)
  values
    (p_account_id, 'cash',      'Cash',          0, true,  false),
    (p_account_id, 'card',      'Card',          1, true,  false),
    (p_account_id, 'transfer',  'Bank transfer', 2, true,  false),
    (p_account_id, 'bizum',     'Bizum',         3, true,  false),
    (p_account_id, 'other',     'Other',         4, true,  false),
    -- Not shown on the settings screen and not offered as a choice. They exist
    -- so the foreign key below holds for payments the app writes itself.
    (p_account_id, 'credit',    'Credit on account', 98, true, true),
    (p_account_id, 'write_off', 'Written off',       99, true, true)
  on conflict (account_id, key) do nothing;
$$;

select seed_payment_methods(id) from accounts;

-- Anything already recorded that the defaults do not cover -- a method added
-- by hand on the settings screen before this, or an import -- becomes a row of
-- its own rather than a foreign key violation. Belt and braces: with the
-- defaults above there is nothing left, but a constraint that can fail on
-- existing data is not one to add hopefully.
insert into payment_methods (account_id, key, name, sort_order, is_active, is_system)
select distinct p.account_id, p.method, initcap(replace(p.method, '_', ' ')), 50, false, true
from payments p
where p.method is not null
  and not exists (
    select 1 from payment_methods pm where pm.account_id = p.account_id and pm.key = p.method
  )
on conflict (account_id, key) do nothing;

-- A new account starts with the same set. A trigger rather than an edit to
-- create_account_with_owner: signup is not the only thing that makes an
-- account (tests and the importer do too), and an account whose first payment
-- is refused by the foreign key would be a very confusing way to find out.
create or replace function seed_payment_methods_for_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_payment_methods(new.id);
  return new;
end;
$$;

create trigger accounts_seed_payment_methods
  after insert on accounts
  for each row execute function seed_payment_methods_for_new_account();

-- ---------------------------------------------------------------------
-- The constraint follows the table instead of a hardcoded list

alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_fkey
  foreign key (account_id, method) references payment_methods (account_id, key);

comment on constraint payments_method_fkey on payments is
  'A payment names a method the account actually has. Also what stops a method being deleted while payments reference it -- the settings screen deleted them freely before.';
