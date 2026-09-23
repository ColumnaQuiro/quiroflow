-- What is owed, and WHY, read from the most recent answer rather than the
-- highest attempt number.
--
-- factura_records_awaiting_aeat picked its row with
-- `order by factura_record_id, attempt desc`, which was right when every
-- attempt inserted a row: the attempt number climbed by one each time and the
-- highest was the newest.
--
-- It stopped being right when repeated identical verdicts began collapsing
-- into the existing row instead of adding to it. Two things broke at once:
--
--   * `attempt` is assigned from the row COUNT at insert time, and the count
--     no longer grows every tick, so the numbers stopped being ordered in
--     time at all.
--   * a collapsed row keeps the attempt number it was first written with, so
--     a row refreshed this morning can still carry a number from a flood
--     three days ago.
--
-- The result: 24 of the 26 outstanding records reported `1100` and `1161`,
-- errors the AEAT last raised before #375 fixed them, while the answers it
-- actually gave this morning -- 1239 and 1114 -- sat in rows with LOWER
-- attempt numbers and were invisible. One record's freshest verdict had
-- attempt 21 against a stale row's 41.
--
-- Nothing was owed wrongly: a record with any Incorrecto is owed whichever
-- Incorrecto is reported. What was wrong is the reason, which is the only
-- thing anyone reads this function for -- and `afterRejection` is set from
-- last_status, so a stale Incorrecto sitting on top of a fresh transport
-- error would have put Subsanacion and RechazoPrevio on a record that was
-- never judged.
--
-- responded_at is the AEAT's answer, sent_at the attempt that earned no
-- answer; both are refreshed when a row is collapsed, so either one is the
-- last time something actually happened to that record. created_at is the
-- fallback for a row that has neither.
create or replace function factura_records_awaiting_aeat(p_account_id uuid)
returns table (
  factura_record_id uuid,
  sequence bigint,
  serie_number text,
  huella text,
  attempts integer,
  last_status text,
  last_error_code text
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
      s.factura_record_id, s.status, s.error_code
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
         coalesce(t.n, 0), l.status, l.error_code
  from factura_records r
  left join latest l on l.factura_record_id = r.id
  left join tally t on t.factura_record_id = r.id
  where r.account_id = p_account_id
    and (l.status is null or l.status not in ('Correcto', 'AceptadoConErrores'))
  order by r.sequence;
end;
$$;

-- Unchanged from where this was defined, restated because `create or
-- replace` keeps the existing grants and saying so is cheaper than someone
-- checking.
revoke execute on function factura_records_awaiting_aeat(uuid) from public, anon;
grant execute on function factura_records_awaiting_aeat(uuid) to authenticated, service_role;

comment on function factura_records_awaiting_aeat(uuid) is
  'Records the AEAT does not hold yet, in chain order, each with the MOST RECENT thing the AEAT said about it. Empty means everything issued has been transmitted and acknowledged.';
