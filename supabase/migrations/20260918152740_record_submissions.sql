-- Whether the AEAT actually took each registro de facturación.
--
-- The chain proves the records were not altered. It says nothing about
-- whether they were ever sent, and under VERI*FACTU being sent is the
-- obligation -- a clinic whose records are perfect and unsent is not
-- compliant, and today nothing in the system could tell the difference.
--
-- This is deliberately a SEPARATE table rather than columns on
-- factura_records. That table is append-only and enforced by a trigger,
-- because the registro is the fiscal artifact and must stay byte-identical
-- for as long as it is kept. Transmission is not part of the record; it is
-- something that happens TO the record, possibly several times. Putting a
-- mutable status on an immutable row would mean relaxing the append-only
-- trigger for "just these columns", and an append-only guarantee with an
-- exception in it is a guarantee nobody can rely on.
--
-- One row per attempt, so the history is legible: a record rejected on
-- Tuesday and accepted on Wednesday has two rows saying exactly that.
--
-- The vocabulary is AEAT's own (Descripción SWeb 1.0.3, §responses), not a
-- translation, so a value here can be matched against their documentation
-- without a mapping table in someone's head:
--
--   Correcto             accepted and registered
--   AceptadoConErrores   registered DESPITE errors -- see below
--   Incorrecto           rejected, NOT registered at the AEAT
--
-- That middle value is the one worth being careful about, and the reason
-- this is modelled at all. "Accepted with errors" is REGISTERED. Re-sending
-- it as a new alta would duplicate a record the AEAT already holds; the
-- correction for it is a subsanación, a different operation entirely. A
-- rejected record is the opposite: it does not exist at the AEAT, so it is
-- fixed and sent again as an ordinary alta (§9.1.3). Treating the two the
-- same way is wrong in both directions, which is why they are not collapsed
-- into a boolean.
create table if not exists factura_record_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  factura_record_id uuid not null references factura_records(id),

  -- 1 for the first try. A record normally has exactly one row; more than
  -- one means it was rejected and re-sent.
  attempt integer not null,

  -- 'queued'  -- ours, not AEAT's: built and waiting to go
  -- 'sent'    -- ours: in flight, no response yet
  -- 'transport_error' -- ours: never reached the AEAT (timeout, TLS, 5xx).
  --              Distinct from 'Incorrecto' on purpose: a rejected record
  --              got an answer and a reason, a transport error got neither,
  --              and only one of them means the payload is wrong.
  status text not null check (status in (
    'queued', 'sent', 'transport_error',
    'Correcto', 'AceptadoConErrores', 'Incorrecto'
  )),

  -- Código Seguro de Verificación, returned once the AEAT holds the record.
  -- This is what proves transmission happened; without it a claim to have
  -- sent something is our word for it.
  aeat_csv text,
  -- IdPeticion, so a submission can be traced in the AEAT's own logs.
  request_id text,
  error_code text,
  error_message text,

  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),

  unique (factura_record_id, attempt)
);

create index if not exists factura_record_submissions_record_idx
  on factura_record_submissions (factura_record_id, attempt desc);

create index if not exists factura_record_submissions_account_idx
  on factura_record_submissions (account_id, created_at desc);

alter table factura_record_submissions enable row level security;

-- Same shape as factura_records: the account can read its own transmission
-- history, nobody writes through the API. Submissions are written by the
-- sender under the service role.
create policy "factura_record_submissions readable by account members"
  on factura_record_submissions for select
  using (is_account_member(account_id));

comment on table factura_record_submissions is
  'One row per attempt to transmit a registro de facturación to the AEAT. Status values Correcto/AceptadoConErrores/Incorrecto are AEAT''s own; the first two mean the record is registered there.';

-- ---------------------------------------------------------------------
-- What still has to go
-- ---------------------------------------------------------------------
--
-- A record is settled once the AEAT holds it -- Correcto or
-- AceptadoConErrores. Anything else is outstanding: never attempted,
-- rejected, still in flight, or lost to a transport error.
--
-- Returned in chain order. The records are chained, so sending them out of
-- order would present the AEAT with a record whose predecessor it has not
-- seen, and a gap that only shows up later is the expensive kind.
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
stable
security definer
set search_path to 'public', 'extensions'
as $$
begin
  -- security definer with an account_id parameter: the account has to be
  -- checked here or any signed-in user could ask about any clinic. Same test
  -- as verify_factura_chain -- auth.role() distinguishes an anonymous
  -- PostgREST caller from an operator at psql, which auth.uid() does not,
  -- because neither has one.
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and not is_account_member(p_account_id) then
    raise exception 'not a member of account %', p_account_id using errcode = '42501';
  end if;

  return query
  with latest as (
    select distinct on (s.factura_record_id)
      s.factura_record_id, s.status, s.attempt, s.error_code
    from factura_record_submissions s
    where s.account_id = p_account_id
    order by s.factura_record_id, s.attempt desc
  )
  select r.id, r.sequence, r.serie_number, r.huella,
         coalesce(l.attempt, 0), l.status, l.error_code
  from factura_records r
  left join latest l on l.factura_record_id = r.id
  where r.account_id = p_account_id
    and (l.status is null or l.status not in ('Correcto', 'AceptadoConErrores'))
  order by r.sequence;
end;
$$;

revoke execute on function factura_records_awaiting_aeat(uuid) from public, anon;
grant execute on function factura_records_awaiting_aeat(uuid) to authenticated, service_role;

comment on function factura_records_awaiting_aeat(uuid) is
  'Records the AEAT does not hold yet, in chain order. Empty means everything issued has been transmitted and acknowledged.';

-- The same question for an operator, across every issuing account -- the
-- number that matters is "how many records has the AEAT not got?", and it
-- should be one query, not one per clinic.
create or replace function factura_records_awaiting_aeat_summary()
returns table (account_id uuid, outstanding bigint, oldest_sequence bigint)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select a.account_id, count(w.*), min(w.sequence)
  from (select distinct factura_records.account_id from factura_records) a
  left join lateral factura_records_awaiting_aeat(a.account_id) w on true
  group by a.account_id;
$$;

revoke execute on function factura_records_awaiting_aeat_summary() from public, anon, authenticated;
grant execute on function factura_records_awaiting_aeat_summary() to service_role;

comment on function factura_records_awaiting_aeat_summary() is
  'Per-account count of records the AEAT has not acknowledged. Service role only.';
