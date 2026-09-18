-- The chain verifier was readable by anyone holding the anon key.
--
-- Two mistakes, and the second one hid the first.
--
-- The guard asked `auth.uid() is not null`, reasoning that a caller with no
-- user must be a cron, the service role or an operator at psql -- all of
-- which already hold full access. But an anonymous PostgREST request has no
-- auth.uid() either. It is indistinguishable from the operator by that test,
-- so the check waved it through and verify_factura_chain, being security
-- definer, then read whatever account_id it was handed. The anon key ships in
-- the client bundle, so that is every clinic's serie numbers and factura ids
-- to anyone who asks.
--
-- What it discloses is limited to problem rows, and every chain in production
-- verifies, so a caller today gets an empty result. That is luck, not
-- security: the moment a chain has a problem to report, the problem is
-- reported to the public.
--
-- The second mistake made the first invisible. `revoke execute ... from
-- public` looked like it closed the door, and for verify_all_factura_chains
-- it did. But Supabase's default privileges grant execute to anon and
-- authenticated DIRECTLY on every new function in public, so revoking from
-- PUBLIC leaves those grants standing -- and for verify_factura_chain, which
-- was never revoked from public at all, anon simply inherited it.
--
-- So: ask about the ROLE, which distinguishes anon from an operator, and
-- revoke from the named roles rather than from public alone. Both, because
-- either alone is a single point of failure on a cross-tenant read.
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
  -- A request arriving through PostgREST carries a role: 'anon',
  -- 'authenticated', or 'service_role'. A direct database connection carries
  -- no claims at all and auth.role() is null -- that is the operator, and the
  -- path verify_all_factura_chains() reaches every account through. Anything
  -- that is not service_role or the operator must belong to the account.
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and not is_account_member(p_account_id) then
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
  'Recomputes every huella in an account''s registro de facturación and checks each link. Returns one row per problem; no rows means the chain verifies. Callers must belong to the account.';

-- Named roles, not just public: Supabase grants execute to anon and
-- authenticated directly, so a revoke from public alone leaves them holding it.
revoke execute on function verify_factura_chain(uuid) from public, anon;
grant execute on function verify_factura_chain(uuid) to authenticated, service_role;

-- Every account at once is the operator's view. A clinic has no business
-- asking it, and it would return one row anyway.
revoke execute on function verify_all_factura_chains() from public, anon, authenticated;
grant execute on function verify_all_factura_chains() to service_role;
