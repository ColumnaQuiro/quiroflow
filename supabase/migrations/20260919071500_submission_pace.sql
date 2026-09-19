-- The pace the AEAT sets, remembered.
--
-- Every response carries TiempoEsperaEnvio: "Segundos de espera entre envíos.
-- Para poder realizar el siguiente envío, el sistema informático deberá
-- esperar a que transcurran <TiempoEsperaEnvio> segundos desde el anterior
-- envío o deberá esperar a tener acumulados un número de registros de
-- facturación igual al límite establecido ... la circunstancia que ocurra
-- primero".
--
-- Two things in that sentence, and missing either one is a bug:
--
--   - The wait is satisfied by EITHER the elapsed seconds OR a full batch.
--     A sender that only ever waited would hold 1000 ready records back for
--     no reason; one that only ever counted would hammer the service.
--   - The interval comes FROM the AEAT, per response. It is not ours to pick,
--     and it can change, so it has to be stored rather than configured.
--
-- Kept on the submission row because that is exactly what it describes: the
-- pace set by the answer to that attempt. A separate settings table would
-- have to be kept in step with the submissions it governs.
alter table factura_record_submissions
  add column if not exists wait_seconds integer;

comment on column factura_record_submissions.wait_seconds is
  'TiempoEsperaEnvio from the AEAT response: seconds to wait after this submission before the next one. Set by the AEAT, not configured.';

-- ---------------------------------------------------------------------
-- May this account send yet?
-- ---------------------------------------------------------------------
--
-- Answers from the most recent attempt that actually reached the AEAT. A
-- transport error set no pace -- nothing answered -- so it does not hold the
-- next attempt back; the thing that failed there was the connection, and
-- retrying promptly is correct.
--
-- Scoped per account. The spec says "desde el anterior envío" by "el sistema
-- informático", and NumeroInstalacion makes each account its own installation,
-- so each clinic's stream paces independently. If the AEAT turns out to
-- throttle per certificate instead -- one certificate serves every clinic
-- here -- this is the function to change, and the submissions table already
-- holds what a global rule would need.
create or replace function factura_submission_ready_at(p_account_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select coalesce(
    (select s.sent_at + make_interval(secs => coalesce(s.wait_seconds, 0))
       from factura_record_submissions s
      where s.account_id = p_account_id
        and s.status in ('Correcto', 'AceptadoConErrores', 'Incorrecto')
        and s.sent_at is not null
      order by s.sent_at desc
      limit 1),
    now() - interval '1 second'
  );
$$;

comment on function factura_submission_ready_at(uuid) is
  'When this account may next submit: the last answered attempt plus the TiempoEsperaEnvio the AEAT returned. In the past when nothing has been sent, or when only transport errors have.';

revoke execute on function factura_submission_ready_at(uuid) from public, anon;
grant execute on function factura_submission_ready_at(uuid) to authenticated, service_role;
