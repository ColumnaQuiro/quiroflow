-- Counting the receptionist's replies, for the monthly allowance.
--
-- The receptionist is priced per reply (20261014184755_receptionist_addon.sql):
-- 1,000 a month included, then EUR 15 for each further 1,000 or part of one.
-- A reply costs about 0.009 USD in model calls, so what is counted is what
-- costs money: every reply it WRITES, sent or left as a draft. Not the test
-- chat (the owner trying it), not a refusal, not a "nothing to say".
--
-- One row per reply rather than a counter column, so a month can be re-read
-- and disputed line by line, and the overage charge (one block per further
-- 1,000) is computed from rows that say when and where each reply was.
create table receptionist_replies (
  id bigint generated always as identity primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  -- 'lead:<id>' or the patient's id, as inbox_reply_drafts and the reply
  -- leases key a conversation. Not a foreign key: the count must survive the
  -- lead or patient being deleted, or deleting them would refund the reply.
  conversation_key text not null,
  delivery text not null check (delivery in ('sent', 'draft')),
  created_at timestamptz not null default now()
);

create index receptionist_replies_account_month on receptionist_replies (account_id, created_at);

alter table receptionist_replies enable row level security;
-- Members read their own account's count (the usage card). Nobody writes
-- through the API: record_receptionist_reply is the only way in.
create policy "staff read receptionist_replies" on receptionist_replies
  for select using (is_account_member(account_id));
select public.require_two_factor_on('public.receptionist_replies');

-- Records one reply. Definer, because the button path drafts with the
-- asker's own client, and members must not be able to insert (or delete)
-- rows of their own. A signed-in caller must belong to the account; the
-- service role (the tick) has no auth.uid() and is trusted.
create or replace function public.record_receptionist_reply(p_account_id uuid, p_conversation_key text, p_delivery text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not is_account_member(p_account_id) then
    raise exception 'not a member of this account';
  end if;
  insert into receptionist_replies (account_id, conversation_key, delivery)
  values (p_account_id, p_conversation_key, p_delivery);
end;
$$;
revoke execute on function public.record_receptionist_reply(uuid, text, text) from public, anon;
grant execute on function public.record_receptionist_reply(uuid, text, text) to authenticated, service_role;

-- Replies so far this calendar month, on the clinic's clock (Europe/Madrid --
-- the allowance resets at midnight on the 1st where the clinic is, not in
-- UTC). Invoker: RLS decides what a member sees, and the service role sees
-- everything.
create or replace function public.receptionist_replies_this_month(p_account_id uuid)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(*)::integer
  from receptionist_replies
  where account_id = p_account_id
    and created_at >= (date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid');
$$;

-- An optional ceiling the clinic sets: once this month's replies reach it,
-- the receptionist writes no more until the 1st. Null is no ceiling. A
-- column here rather than on `accounts`, so it sits behind the same
-- communication_config permission as everything else the receptionist says.
alter table receptionist_config add column monthly_reply_limit integer check (monthly_reply_limit is null or monthly_reply_limit > 0);
