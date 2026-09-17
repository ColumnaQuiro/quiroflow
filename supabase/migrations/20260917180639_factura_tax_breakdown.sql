-- What a factura is made of, tax-wise: base, rate, cuota, and the exemption.
--
-- Until now a factura stored one number -- amount_cents -- and the PDF printed
-- it as "Total". That is not enough for two separate reasons, and the second
-- is the one with a deadline:
--
--   RD 1619/2012 already requires an invoice to state the base imponible, the
--   rate and the cuota, or to cite the provision the operation is exempt
--   under. A document showing only a total does not do that.
--
--   VERI*FACTU (RD 1007/2023, obligatory 1 Jan 2027 for sociedades and
--   1 Jul 2027 for the rest) requires a registro de facturación de alta per
--   invoice, and that record carries the desglose. Without these columns there
--   is nothing to build the record from -- whether we submit to the AEAT
--   ourselves or hand the data to a provider that does. Every other part of
--   that work sits behind this one.
--
-- ColumnaQuiro's services are exempt under art. 20.Uno.3 of Ley 37/1992
-- (asistencia sanitaria), so base equals total, cuota is zero, and the invoice
-- must say why. The AEAT's CausaExencion code for "exenta por el artículo 20"
-- is E1, which is what is stored -- the code rather than the sentence, so the
-- printed wording can be corrected without rewriting history.
--
-- Deliberately per-factura rather than looked up from the account at render
-- time. A rate or an exemption is a fact about the operation on the day it
-- happened; an account setting is a fact about today. Storing the first as
-- the second is how a clinic that changes its tax treatment silently rewrites
-- every invoice it ever issued.

alter table facturas
  add column if not exists tax_base_cents integer,
  add column if not exists tax_rate_bp integer not null default 0,
  add column if not exists tax_amount_cents integer not null default 0,
  add column if not exists tax_exemption_code text;

comment on column facturas.tax_rate_bp is
  'IVA rate in basis points (2100 = 21%). Zero when exempt.';
comment on column facturas.tax_exemption_code is
  'AEAT CausaExencion: E1 art.20, E2 art.21, E3 art.22, E4 art.23/24, E5 art.25, E6 other. Null when the operation is taxed.';

alter table facturas
  add constraint facturas_tax_exemption_code_check
  check (tax_exemption_code is null or tax_exemption_code in ('E1', 'E2', 'E3', 'E4', 'E5', 'E6'));

-- An exempt operation has no cuota; a taxed one must not claim an exemption.
alter table facturas
  add constraint facturas_tax_coherent_check
  check (
    (tax_exemption_code is not null and tax_rate_bp = 0 and tax_amount_cents = 0)
    or (tax_exemption_code is null)
  );

-- Existing facturas were all issued by ColumnaQuiro under the same exemption,
-- so their base is their total and their cuota is zero. This restates what was
-- already true rather than changing any figure: no total moves.
update facturas
set tax_base_cents = amount_cents,
    tax_rate_bp = 0,
    tax_amount_cents = 0,
    tax_exemption_code = 'E1'
where tax_base_cents is null;

alter table facturas alter column tax_base_cents set not null;

-- The default a new factura is issued under, so the issuing code does not
-- hardcode one clinic's tax position. A clinic that is not exempt sets a rate
-- and clears the code.
alter table accounts
  add column if not exists factura_tax_rate_bp integer not null default 0,
  add column if not exists factura_tax_exemption_code text default 'E1';

alter table accounts
  add constraint accounts_factura_tax_exemption_code_check
  check (factura_tax_exemption_code is null or factura_tax_exemption_code in ('E1', 'E2', 'E3', 'E4', 'E5', 'E6'));
