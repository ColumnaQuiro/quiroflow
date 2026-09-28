-- Settings > VeriFactu > "Who sends": a clinic either sends with its own
-- certificate, as until now, or lets QuiroFlow send for it with the
-- platform's certificate. The AEAT allows the second in two ways, and the
-- clinic picks which:
--
--   apoderamiento        The clinic grants procedure IZ860 ("Remisión y
--                        consulta de registros de facturación por servicio
--                        web") to the platform company in the AEAT's Registro
--                        de Apoderamientos, and the platform accepts it there.
--   colaboracion_social  The platform is a colaborador social (agreement
--                        Tipo 017), and the clinic signs the representation
--                        document of the Resolución of 18 Dec 2024
--                        (BOE-A-2024-27600) -- a real signature, handwritten
--                        or qualified electronic; clicking "I agree" is not one.
--
-- Either way the records still name the clinic as ObligadoEmision; only the
-- certificate on the connection changes. The AEAT checks that its holder may
-- send for that NIF and answers 4112 when it may not.

alter table accounts
  add column verifactu_sender text not null default 'own_certificate'
    check (verifactu_sender in ('own_certificate', 'apoderamiento', 'colaboracion_social'));

comment on column accounts.verifactu_sender is
  'Whose certificate transmits this clinic''s VeriFactu records: its own (verifactu_certificates), or the platform''s under an apoderamiento or colaboración social (verifactu_delegations).';

-- One row per clinic that asked QuiroFlow to send for it. The acceptance is
-- a fact about the AEAT, set by hand by the platform once it has accepted
-- the apoderamiento in the AEAT's office (or filed the signed document): the
-- sender uses the platform certificate for a clinic only from then on,
-- because before it every submission would be refused with 4112.
create table verifactu_delegations (
  account_id uuid primary key references accounts(id) on delete cascade,
  route text not null check (route in ('apoderamiento', 'colaboracion_social')),
  requested_at timestamptz not null default now(),
  requested_by uuid references auth.users(id) on delete set null,

  -- colaboracion_social only: the representation document as the clinic
  -- signed it. Kept here like the certificates, base64, service role only.
  signed_document_base64 text,
  signed_document_name text,
  signed_document_uploaded_at timestamptz,

  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

alter table verifactu_delegations enable row level security;

-- No policy, like verifactu_certificates: a signed document with an ID in it
-- has no reason to be readable through the API. Settings and the platform's
-- review list read it through server routes with the service role.
select public.require_two_factor_on('public.verifactu_delegations');

comment on table verifactu_delegations is
  'Clinics that asked QuiroFlow to send their VeriFactu records with the platform certificate, and whether the AEAT authorisation behind it has been accepted. Service role only.';

-- Which account IS the platform: its certificate is the one that sends for
-- delegated clinics, its clinic's NIF and legal name are what those clinics
-- authorise at the AEAT, and its owners are the people who accept the
-- delegations. A table of its own rather than a flag on accounts, because
-- clinics can update their own accounts row and this must not be something
-- a clinic can set on itself. One row at most.
create table verifactu_platform (
  singleton boolean primary key default true check (singleton),
  account_id uuid not null references accounts(id) on delete restrict
);

alter table verifactu_platform enable row level security;
select public.require_two_factor_on('public.verifactu_platform');

comment on table verifactu_platform is
  'The account whose certificate sends for clinics in verifactu_delegations, and whose owners accept them. Service role only.';

-- Columnaquiro S.L. (B16365504): the company behind QuiroFlow, whose
-- certificate is already the one on its own account. Matches nothing on a
-- database without that account, so a fresh environment has no platform.
insert into verifactu_platform (account_id)
select id from accounts where id = 'ff112316-8768-4e5a-a495-b5025cefb6f2'
on conflict do nothing;
