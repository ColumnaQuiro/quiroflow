-- Where the certificate lives.
--
-- Not in an environment variable, which is where it was going to go until the
-- base64 turned out to be 5,392 bytes. A Netlify function runs in Lambda
-- compatibility mode, where the TOTAL size of every environment variable is
-- capped at 4 KB -- so the certificate alone exceeds the budget for all of
-- them together, before the Supabase keys, the Stripe keys and the rest.
-- Measured rather than assumed: the deploy would simply have been refused.
--
-- The passphrase stays in the environment, where it is small and belongs.
-- That split is the point rather than an accident: this table holds a
-- certificate nobody can use without the passphrase, and the passphrase is
-- held somewhere that does not have the certificate.
--
-- Per account from the start. Today one clinic transmits its own records
-- under its own certificate; the next either brings its own or grants
-- apoderamiento for ours, and both of those are a row here rather than a
-- redeploy.
create table if not exists verifactu_certificates (
  account_id uuid primary key references accounts(id) on delete cascade,

  -- PKCS#12, base64. Must be the modern encryption: a .p12 written by an
  -- older tool uses RC2-40-CBC, which the OpenSSL 3 that Node links against
  -- refuses with an "unsupported algorithm" error that names neither the
  -- certificate nor the fix.
  pkcs12_base64 text not null,

  -- 'representative' (a named person acting for the company) or 'seal' (an
  -- entity's certificado de sello). It picks the AEAT host, and the wrong
  -- host fails at the TLS handshake -- an error that says nothing about
  -- certificates.
  certificate_type text not null default 'representative'
    check (certificate_type in ('representative', 'seal')),

  -- What the certificate says about itself, recorded when it is stored.
  -- subject is for a human deciding whether this is the right one; not_after
  -- is what stops transmission failing silently.
  subject text,
  not_after timestamptz,

  updated_at timestamptz not null default now()
);

alter table verifactu_certificates enable row level security;

-- No policy at all, deliberately. factura_records has a read policy because
-- a clinic has reason to see its own fiscal records; nobody has reason to
-- read a private key through the API, including the account that owns it.
-- Only the service role, which bypasses RLS, ever touches this.

comment on table verifactu_certificates is
  'The PKCS#12 certificate each account transmits with, base64-encoded. Service role only; RLS denies everyone. The passphrase is NOT here -- it lives in the environment, so neither store is useful alone.';

-- ---------------------------------------------------------------------
-- Saying so before it expires
-- ---------------------------------------------------------------------
--
-- A certificate that quietly expires stops transmission, and under VERI*FACTU
-- that is a compliance failure which looks exactly like a quiet week. The one
-- in use expires 16 Feb 2028 and is tied to an individual, so it can also be
-- revoked earlier without anybody here being told.
--
-- Thirty days is enough to obtain a replacement without it being an
-- emergency: an FNMT renewal is an appointment, not a download.
create or replace function verifactu_certificates_expiring(p_within_days integer default 30)
returns table (account_id uuid, subject text, not_after timestamptz, days_left integer)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select c.account_id, c.subject, c.not_after,
         floor(extract(epoch from (c.not_after - now())) / 86400)::integer
  from verifactu_certificates c
  where c.not_after is not null
    and c.not_after < now() + make_interval(days => p_within_days)
  order by c.not_after;
$$;

comment on function verifactu_certificates_expiring(integer) is
  'Certificates expiring within the given window, soonest first. A negative days_left means it has already expired and nothing is being transmitted.';

revoke execute on function verifactu_certificates_expiring(integer) from public, anon, authenticated;
grant execute on function verifactu_certificates_expiring(integer) to service_role;
