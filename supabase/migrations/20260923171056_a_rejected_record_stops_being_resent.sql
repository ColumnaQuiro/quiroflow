-- A record the AEAT keeps refusing stops being resent, and says so.
--
-- There was no terminal state. factura_records_awaiting_aeat returned every
-- record whose latest verdict was not Correcto or AceptadoConErrores, with no
-- cap, no backoff and nowhere for a record to land that the AEAT will never
-- accept. The sender runs every minute, so a permanently-invalid record was
-- offered 1,440 times a day for as long as it existed. R-2026-0004 reached
-- attempt 148 that way.
--
-- That is not merely wasteful. It is what turned #420's Subsanacion bug from
-- wrong into permanent: a rejected record was flagged as a subsanación, the
-- AEAT answered 3002 "No existe el registro de facturación", 3002 is itself
-- Incorrecto, so the flag stayed on and the record could never be sent again
-- under any circumstances. A retry loop with no exit does not just repeat a
-- mistake, it preserves it.
--
-- WHY A REPEAT COUNT AND NOT AN ERROR CODE. The tempting rule is to park on
-- the codes that describe the record's own content -- 1100, 1239 -- since the
-- record is immutable and a byte-identical resend earns a byte-identical
-- answer. It is wrong for the case that matters most: Encadenamiento means a
-- record can be refused for its PREDECESSOR's state, and such a record starts
-- succeeding the moment the one before it is accepted. Parking it on the code
-- would strand a record that was about to recover on its own.
--
-- A repeat count handles that without a list to maintain. If the predecessor
-- is fixed, the verdict CHANGES, which the sender writes as a new row, which
-- starts the count again. Only a record whose answer never moves parks.
--
-- Ten repeats, at one a minute, is ten minutes of recovery room before the
-- flood stops. It is not a guess about which errors are fatal, which is the
-- part that would have to be relearned every time the AEAT adds a code.

-- How many times the AEAT has returned this EXACT verdict for this record.
--
-- It cannot be counted from the rows. #375 made an identical verdict refresh
-- its existing row rather than insert a new one -- 21 records refused for one
-- field had grown this table by 145 rows in ten minutes -- so a record stuck
-- on 3002 for a day has exactly one 3002 row, and the row count says "1".
-- The collapse is what makes the table readable; this is the fact the
-- collapse would otherwise destroy.
--
-- Defaults to 1 because a row exists only once a verdict has been given once.
alter table factura_record_submissions
  add column if not exists repeats integer not null default 1;

comment on column factura_record_submissions.repeats is
  'How many times the AEAT has returned this same status and error_code for this record. 1 on the first answer, incremented each time an identical verdict collapses into this row.';

-- Both dropped and rebuilt rather than replaced: each gains a column, and
-- create or replace cannot change a function's return type. The summary goes
-- first because it reads the other one.
drop function if exists factura_records_awaiting_aeat_summary();
drop function if exists factura_records_awaiting_aeat(uuid);

create or replace function factura_records_awaiting_aeat(p_account_id uuid)
returns table (
  factura_record_id uuid,
  sequence bigint,
  serie_number text,
  huella text,
  attempts integer,
  last_status text,
  last_error_code text,
  parked boolean
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and not is_account_member(p_account_id) then
    raise exception 'not a member of account %', p_account_id using errcode = '42501';
  end if;

  return query
  with latest as (
    select distinct on (s.factura_record_id)
      s.factura_record_id, s.status, s.error_code, s.repeats
    from factura_record_submissions s
    where s.account_id = p_account_id
    order by s.factura_record_id,
             coalesce(s.responded_at, s.sent_at, s.created_at) desc,
             s.id desc
  ),
  -- Counted rather than read off the row. `attempt` was only ever a proxy
  -- for "how many times has this been tried", and collapsing broke that too:
  -- the rows that remain no longer number the attempts.
  tally as (
    select s.factura_record_id, count(*)::integer as n
    from factura_record_submissions s
    where s.account_id = p_account_id
    group by s.factura_record_id
  )
  select r.id, r.sequence, r.serie_number, r.huella,
         coalesce(t.n, 0), l.status, l.error_code,
         -- Only a REJECTION parks. A transport error is not a verdict about
         -- the record -- the AEAT never judged it -- and an outage that lasts
         -- ten minutes must not retire the queue it was blocking.
         coalesce(l.status = 'Incorrecto' and l.repeats >= 10, false)
  from factura_records r
  left join latest l on l.factura_record_id = r.id
  left join tally t on t.factura_record_id = r.id
  where r.account_id = p_account_id
    and (l.status is null or l.status not in ('Correcto', 'AceptadoConErrores'))
  order by r.sequence;
end;
$$;

revoke execute on function factura_records_awaiting_aeat(uuid) from public, anon;
grant execute on function factura_records_awaiting_aeat(uuid) to authenticated, service_role;

comment on function factura_records_awaiting_aeat(uuid) is
  'Records the AEAT does not hold yet, in chain order, each with the MOST RECENT thing the AEAT said about it. `parked` marks one the AEAT has refused identically ten times: still owed, no longer resent. Empty means everything issued has been transmitted and acknowledged.';

-- A parked record is STILL RETURNED HERE, flagged rather than filtered.
--
-- Hiding it would make this function's own comment false -- the AEAT does not
-- hold it, so it is owed -- and would answer "what is outstanding?" with a
-- number that quietly excludes the records most in need of attention. That is
-- the same shape of mistake as reading a stale verdict off the highest
-- attempt number, which this function already had once. The sender is what
-- declines to send them; the accounting keeps counting them.
create or replace function factura_records_awaiting_aeat_summary()
returns table (account_id uuid, outstanding bigint, parked bigint, oldest_sequence bigint)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select a.account_id,
         count(w.*),
         count(w.*) filter (where w.parked),
         min(w.sequence)
  from (select distinct factura_records.account_id from factura_records) a
  left join lateral factura_records_awaiting_aeat(a.account_id) w on true
  group by a.account_id;
$$;

revoke execute on function factura_records_awaiting_aeat_summary() from public, anon, authenticated;
grant execute on function factura_records_awaiting_aeat_summary() to service_role;

comment on function factura_records_awaiting_aeat_summary() is
  'Per-account count of records the AEAT has not acknowledged, and how many of those are parked. Service role only.';

-- Putting parked records back in the air.
--
-- Parking is deliberately not self-clearing. The count does not fall on its
-- own, and a deploy does not reset it, because "the code changed" is not
-- evidence that THIS record will now be accepted -- that was the assumption
-- behind resending every minute in the first place. Someone decides.
--
-- Resetting to 1 rather than 0 keeps the column's meaning intact: the row
-- still represents one verdict that was given. The next identical answer
-- makes it 2 and the ten minutes start again, so a fix that did not work
-- parks the record a second time instead of resuming the flood.
create or replace function factura_records_release_parked(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  released integer;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and not is_account_member(p_account_id) then
    raise exception 'not a member of account %', p_account_id using errcode = '42501';
  end if;

  update factura_record_submissions s
     set repeats = 1
   where s.account_id = p_account_id
     and s.status = 'Incorrecto'
     and s.repeats >= 10;

  get diagnostics released = row_count;
  return released;
end;
$$;

revoke execute on function factura_records_release_parked(uuid) from public, anon;
grant execute on function factura_records_release_parked(uuid) to authenticated, service_role;

comment on function factura_records_release_parked(uuid) is
  'Clears the repeat count on parked submissions so the sender offers those records again. Returns how many were released. Deliberately manual: parking is a decision to stop, and only a person knows whether the reason has been addressed.';
