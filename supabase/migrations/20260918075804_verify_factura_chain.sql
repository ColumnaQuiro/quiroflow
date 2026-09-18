-- Checking the chain, rather than trusting it.
--
-- The registro de facturación is tamper-EVIDENT: alter a record and the
-- huellas stop agreeing. But evidence nobody looks at is not evidence, and
-- until now nothing in the system could actually look. Both halves of the
-- regime expect a SIF to be able to verify the huella and the chaining of its
-- own records -- and independently of the regulation, a clinic asked "can you
-- prove these invoices have not been altered?" should be able to answer with
-- something better than "the trigger would have stopped it".
--
-- Two distinct faults, reported separately because they mean different
-- things:
--
--   huella_mismatch  -- the record's stored huella is not what its own
--                       contents hash to. The record itself was altered.
--   broken_link      -- the record's previous_huella is not the huella of the
--                       record before it. Something was removed, reordered,
--                       or inserted into the middle.
--   stale_spec_version -- the record was built by a formula this database no
--                       longer implements, so its huella cannot be recomputed
--                       here at all. Not tampering: a chain awaiting rebuild.
--
-- That third case is the reason the version is checked before the hash.
-- Recomputing an old record with today's formula produces a different digest
-- every time, and reporting that as huella_mismatch would accuse the clinic
-- of altering invoices it never touched -- the most damaging thing this
-- function could get wrong.
--
-- Each record is judged against its own contents and its own recorded
-- predecessor, and the walk continues from the STORED huella rather than the
-- recomputed one. Otherwise a single altered record cascades and every
-- subsequent record is reported as broken too, which buries the one fact
-- worth knowing: where it started.

create or replace function factura_huella_spec_version()
returns text
language sql
immutable
as $$ select 'aeat-0.1.2'::text $$;

comment on function factura_huella_spec_version() is
  'The formula factura_huella_input implements today. Stamped on new records and checked by verify_factura_chain; bump it in the same migration that changes the formula, and rebuild.';

create or replace function verify_factura_chain(p_account_id uuid)
returns table (
  sequence bigint,
  factura_id uuid,
  serie_number text,
  problem text
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  r factura_records;
  v_prev text := null;
  v_expected text;
begin
  -- security definer, so the account has to be checked here: without this
  -- any signed-in user could ask about any clinic and read back its serie
  -- numbers.
  --
  -- The test is whether there is an end user at all. A request carrying a
  -- user's JWT must belong to the account. A service_role call, a cron, or
  -- an operator at psql has no auth.uid() and already holds full access by
  -- other means -- and verify_all_factura_chains() below reaches every
  -- account through exactly that path.
  if auth.uid() is not null and not is_account_member(p_account_id) then
    raise exception 'not a member of account %', p_account_id using errcode = '42501';
  end if;

  for r in
    select * from factura_records
    where account_id = p_account_id
    order by factura_records.sequence
  loop
    if r.previous_huella is distinct from v_prev then
      sequence := r.sequence;
      factura_id := r.factura_id;
      serie_number := r.serie_number;
      problem := 'broken_link';
      return next;
    end if;

    if r.huella_spec_version is distinct from factura_huella_spec_version() then
      -- Say so and move on. The link check above still applies, because
      -- comparing two stored strings needs no formula.
      sequence := r.sequence;
      factura_id := r.factura_id;
      serie_number := r.serie_number;
      problem := 'stale_spec_version';
      return next;
    else
      v_expected := factura_huella(factura_huella_input(
        r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
        r.cuota_total_cents, r.importe_total_cents, r.previous_huella, r.generated_at
      ));

      if r.huella <> v_expected then
        sequence := r.sequence;
        factura_id := r.factura_id;
        serie_number := r.serie_number;
        problem := 'huella_mismatch';
        return next;
      end if;
    end if;

    v_prev := r.huella;
  end loop;
end;
$$;

comment on function verify_factura_chain(uuid) is
  'Recomputes every huella in an account''s registro de facturación and checks each link. Returns one row per problem; no rows means the chain verifies.';

-- The same question asked of every account at once, for an operator who wants
-- one number rather than a report per clinic.
create or replace function verify_all_factura_chains()
returns table (account_id uuid, problems bigint)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select a.account_id, count(v.*) as problems
  from (select distinct factura_records.account_id from factura_records) a
  left join lateral verify_factura_chain(a.account_id) v on true
  group by a.account_id;
$$;

-- Every account, so this one is service_role only: it is the operator's
-- view, and per-account membership would make it return one row anyway.
revoke execute on function verify_all_factura_chains() from public;
grant execute on function verify_all_factura_chains() to service_role;

comment on function verify_all_factura_chains() is
  'One row per issuing account with the number of problems found. Every count zero means every chain verifies.';

-- ---------------------------------------------------------------------
-- The version stamp has to be true, or verification means nothing
-- ---------------------------------------------------------------------
--
-- huella_spec_version exists so a chain built under one formula can be found
-- and rebuilt when the formula is corrected. That is exactly what happened
-- when the huella was pinned to AEAT's own vector: the formula was fixed and
-- every existing row rebuilt and re-stamped 'aeat-0.1.2'.
--
-- But record_factura_alta -- the function that writes NEW records -- still
-- stamped 'draft-2026-09-unverified'. The huella on those rows would be
-- right, because it calls the corrected factura_huella_input; only the label
-- saying which formula produced it would be wrong. So every factura issued
-- from here on would claim to have been built by a formula that no longer
-- exists, and a later rebuild looking for draft rows would find rows that
-- were never draft. Nothing visibly breaks, which is the problem: the column
-- whose entire job is to answer "which formula built this?" would answer
-- incorrectly, on a fiscal record, forever.
--
-- One place names the current formula now, so the hash and its label cannot
-- disagree again.
create or replace function record_factura_alta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_nif text;
  v_prev text;
  v_generated timestamptz := now();
  v_input text;
begin
  -- Serialise per issuer. Two facturas inserted concurrently would otherwise
  -- read the same predecessor and both claim to follow it, forking the chain
  -- silently -- the one failure mode that would make the whole record
  -- worthless while looking perfectly healthy.
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(new.account_id::text));

  select c.tax_id into v_nif
  from clinics c
  where c.account_id = new.account_id
  order by c.created_at
  limit 1;

  select r.huella into v_prev
  from factura_records r
  where r.account_id = new.account_id
  order by r.sequence desc
  limit 1;

  v_input := factura_huella_input(
    coalesce(v_nif, ''),
    new.number,
    (new.issued_at at time zone 'UTC')::date,
    factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0),
    new.amount_cents,
    v_prev,
    v_generated
  );

  insert into factura_records (
    account_id, factura_id, record_type, issuer_nif, serie_number, issued_on,
    invoice_type, cuota_total_cents, importe_total_cents, generated_at,
    previous_huella, huella, huella_spec_version
  ) values (
    new.account_id, new.id, 'alta', coalesce(v_nif, ''), new.number,
    (new.issued_at at time zone 'UTC')::date, factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0), new.amount_cents, v_generated,
    v_prev, factura_huella(v_input), factura_huella_spec_version()
  );

  return new;
end;
$$;

-- Any record already written with the wrong label. The rebuild in
-- 20260918072557 re-stamped every row that existed then, so a row still
-- carrying the draft label was necessarily written after it, by the
-- corrected formula, under the wrong name.
--
-- Rather than trust that reasoning, each row is asked to prove it: the label
-- is corrected only where the stored huella is what the CURRENT formula
-- produces from that row's own contents. A row built by some other formula
-- fails that test, keeps its draft label, and is reported by
-- verify_factura_chain as stale rather than being quietly renamed -- which is
-- the outcome that would actually destroy the audit trail.
-- Through the append-only gate, in one transaction that changes no huella and
-- deletes nothing.
do $$
begin
  perform set_config('quiroflow.rebuilding_huellas', 'on', true);

  update factura_records r
  set huella_spec_version = factura_huella_spec_version()
  where r.huella_spec_version = 'draft-2026-09-unverified'
    and r.huella = factura_huella(factura_huella_input(
          r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
          r.cuota_total_cents, r.importe_total_cents, r.previous_huella, r.generated_at
        ));

  perform set_config('quiroflow.rebuilding_huellas', 'off', true);
end;
$$;
