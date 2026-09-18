-- IndicadorMultiplesOT, which the system has to work out for itself.
--
-- AEAT's record design is unusually specific about this one field
-- (DsRegistroVeriFactu.xlsx, «5)Definición SistemaInformatico»): the value
--
--   "deberá obtenerlo automáticamente el sistema informático a partir del
--    número de obligados tributarios contenidos y/o gestionados en él en ese
--    momento, independientemente de su estado operativo (alta, baja...), no
--    pudiendo obtenerse a partir de otra información ni ser introducido
--    directamente por el usuario del sistema informático ni cambiado por él"
--
-- So it is explicitly NOT configuration. A constant in the code would be the
-- wrong shape even when it happened to be the right letter, because the
-- requirement is that the system COUNTS -- and a hosted product's count
-- changes every time a clinic signs up, without anyone editing anything.
--
-- "N" means the system holds exactly one obligado, and that one is the issuer
-- of this record. Anything else is "S".
--
-- Counted over accounts regardless of operational state, which is what
-- "independientemente de su estado operativo" asks for: a cancelled clinic is
-- still an obligado the system contains. Trials count for the same reason --
-- the test is containment, not billing.
create or replace function sif_indicador_multiples_ot()
returns text
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select case when (select count(*) from accounts) > 1 then 'S' else 'N' end;
$$;

comment on function sif_indicador_multiples_ot() is
  'IndicadorMultiplesOT for the SistemaInformatico block: S when the system holds more than one obligado tributario. Derived from the account count at call time, which RD 1007/2023''s record design requires -- it may not be configured or entered by a user.';

-- Readable by a signed-in user: it is a property of the software, not of any
-- clinic's data, and it discloses only whether QuiroFlow has more than one
-- customer. Not granted to anon, which has no reason to ask.
revoke execute on function sif_indicador_multiples_ot() from public, anon;
grant execute on function sif_indicador_multiples_ot() to authenticated, service_role;
