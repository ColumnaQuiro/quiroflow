// Actually sending the records.
//
// Everything either side of the wire already exists and is tested: the
// registro (#326), the RegistroAlta XML (#330), the envelope and the response
// parser (#331). This is the part in between -- deciding what to send, sending
// it over a certificate, and writing down what came back.
//
// THE FOUR-MINUTE WINDOW -- read this before scheduling anything.
//
// The AEAT's preproduction service, on the first real submission, returned:
//
//   2004  El valor del campo FechaHoraHusoGenRegistro debe ser la fecha
//         actual del sistema de la AEAT, admitiéndose un margen de error
//         de: 240 segundos.
//
// A record must reach the AEAT within FOUR MINUTES of being generated. That
// appears nowhere in the record design or the web service description; only
// the live service says it.
//
// It is not fatal -- the records came back AceptadoConErrores, which means
// registered, with a CSV. But a fiscal record registered with a complaint
// about its own timestamp is not a thing to ship deliberately, and it makes
// the obvious schedule wrong: a cron every 15 minutes would earn this error
// on nearly every record.
//
// So whatever calls this must run about every minute. That sits comfortably
// with the other constraint, TiempoEsperaEnvio, which has been 60 seconds on
// every response so far: send no more often than the AEAT allows, and no
// less often than it tolerates.
//
// The 53 records backfilled on 18 Sep can never satisfy this -- their
// generated_at is historical and the record is immutable, which is the whole
// point of it. They will register with 2004 whenever they go, and that is
// the correct outcome rather than a bug to work around: the alternative is
// restating when they were generated, which would be false.
//
// It cannot send anything yet, and says so rather than failing obscurely at
// the first record. What is missing is not code: a configured certificate,
// and the passphrase for it.
import { Agent, request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { buildRegistroAlta } from '~/utils/registroAlta'
import {
  MAX_RECORDS_PER_SUBMISSION,
  hasCertificate,
  type BlockedReason,
  type SenderConfig,
  buildRegFactuEnvelope,
  parseVerifactuResponse,
  transmissionBlockedBy,
  verifactuEndpoint,
} from '~/utils/verifactuSoap'

/**
 * The mTLS agent. Built per send rather than held, so a rotated certificate
 * is picked up without a restart -- certificates expire, and the failure mode
 * of a cached one is every record silently failing until someone redeploys.
 */
export function buildAgent(config: SenderConfig): Agent {
  // Base64 first: that is what production uses. The path is for a developer
  // with the .p12 on their own machine.
  const pfx = config.certificateBase64
    ? Buffer.from(config.certificateBase64, 'base64')
    : config.certificatePath
      ? readFileSync(config.certificatePath)
      : null
  if (!pfx) throw new Error('verifactu: no certificate configured')

  // A certificate written by an older tool is PKCS#12 in the legacy format
  // (RC2-40-CBC), which the OpenSSL 3 that Node links against refuses
  // outright -- with an "unsupported" error that names an algorithm and not
  // the certificate. Columnaquiro's was exactly that, and had to be
  // re-wrapped with AES before Node would load it. Worth knowing, because
  // the message gives no hint of the fix.
  return new Agent({ pfx, passphrase: config.certificatePassphrase, keepAlive: false })
}

/**
 * The certificate for an account, from the store.
 *
 * Read per send rather than cached: a renewed certificate is a row update,
 * and the next tick should pick it up without a redeploy. That matters more
 * than the query -- the one in use expires in February 2028 and is tied to an
 * individual, so it can be revoked before then with no warning to us.
 */
export async function certificateFor(
  supabase: SupabaseClient<Database>,
  accountId: string,
): Promise<Pick<SenderConfig, 'certificateBase64' | 'certificateType' | 'certificateNotAfter'> | null> {
  const { data } = await supabase
    .from('verifactu_certificates')
    .select('pkcs12_base64, certificate_type, not_after')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return null
  return {
    certificateBase64: data.pkcs12_base64,
    certificateType: data.certificate_type === 'seal' ? 'seal' : 'representative',
    certificateNotAfter: data.not_after ? new Date(data.not_after) : undefined,
  }
}

/** The sender's configuration, from runtimeConfig. */
export function verifactuConfigFrom(runtime: {
  verifactuEnvironment?: string
  verifactuCertificateBase64?: string
  verifactuCertificatePassphrase?: string
  verifactuCertificateType?: string
}): SenderConfig {
  return {
    // Defaults to 'test'. Reaching production has to be a deliberate act of
    // configuration, not what happens when a variable is unset.
    environment: runtime.verifactuEnvironment === 'production' ? 'production' : 'test',
    certificateBase64: runtime.verifactuCertificateBase64 || undefined,
    // String() on purpose. Nuxt runs environment variables through destr, so
    // a passphrase that happens to be all digits arrives as a NUMBER -- and
    // Node answers that with "Pass phrase must be a buffer", which names
    // neither the passphrase nor its type nor the variable it came from.
    //
    // That is what 819 transport errors in production turned out to be. The
    // certificate was right, the store was right, the transport was right;
    // the password was a number.
    certificatePassphrase: runtime.verifactuCertificatePassphrase
      ? String(runtime.verifactuCertificatePassphrase)
      : undefined,
    certificateType: runtime.verifactuCertificateType === 'seal' ? 'seal' : 'representative',
  }
}

/**
 * POST the envelope with the client certificate attached.
 *
 * node:https rather than fetch, and this is not a style choice. Node's fetch
 * is undici, which IGNORES an https.Agent passed as `agent` -- silently. The
 * request goes out with no client certificate, the AEAT refuses an anonymous
 * caller, and what comes back is not a VERI*FACTU response at all.
 *
 * That is exactly what happened in production: 1,153 ticks, every one
 * "succeeded", not one record transmitted and not one row explaining why. The
 * hazard was written down in the throwaway probe -- which used node:https for
 * this reason -- and then not applied here, behind a @ts-expect-error that
 * said undici "accepts a dispatcher/agent". It does not.
 */
function postWithCertificate(
  url: string,
  body: string,
  config: SenderConfig,
): Promise<{ status: number; body: string }> {
  const agent = buildAgent(config)
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// The fields of factura_records_awaiting_aeat this actually uses, not its
// whole shape. `last_status` is deliberately absent: it is what the removed
// `afterRejection` was computed from, and nothing here should be deciding what
// to PUT IN a record based on the verdict on the last one.
interface PendingRecord {
  factura_record_id: string
  sequence: number
  serie_number: string
  /**
   * The AEAT has refused this record identically ten times. Still owed --
   * factura_records_awaiting_aeat goes on returning it, because it is -- but
   * no longer offered, because nothing about resending an immutable record
   * byte-for-byte makes the eleventh answer differ from the tenth.
   */
  parked: boolean
}

/**
 * Sends one batch for one account and records what happened.
 *
 * One account per call because Cabecera names a single obligado -- a batch
 * cannot span clinics however convenient that would be.
 */
export async function sendPendingRecords(
  supabase: SupabaseClient<Database>,
  accountId: string,
  config: SenderConfig,
): Promise<{ sent: number; parked: number; blocked: BlockedReason | null; estadoEnvio: string | null }> {
  const { data: pendingRaw } = await supabase.rpc('factura_records_awaiting_aeat', { p_account_id: accountId })

  // Parked records are dropped HERE rather than by the query, so the thing
  // that counts what is owed and the thing that decides what to send do not
  // disagree about the word "outstanding". They are still owed; they are just
  // not going out again until someone looks at them.
  const owed = (pendingRaw ?? []) as PendingRecord[]
  const parked = owed.filter((p) => p.parked).length
  const pending = owed.filter((p) => !p.parked).slice(0, MAX_RECORDS_PER_SUBMISSION)

  const { data: readyAtRaw } = await supabase.rpc('factura_submission_ready_at', { p_account_id: accountId })
  const readyAt = new Date((readyAtRaw as unknown as string) ?? Date.now())

  // The store wins over anything configured by hand. Configuration is the
  // developer's escape hatch; the store is where a renewed certificate lands,
  // and a stale env var silently taking precedence over it is the bug this
  // ordering prevents.
  const stored = await certificateFor(supabase, accountId)
  const effective: SenderConfig = stored ? { ...config, ...stored } : config

  const blocked = transmissionBlockedBy({ config: effective, pendingCount: pending.length, readyAt })
  if (blocked) return { sent: 0, parked, blocked, estadoEnvio: null }

  const built = await buildRecordsFor(supabase, accountId, pending, effective)
  if (built.registros.length === 0) return { sent: 0, parked, blocked: 'nothing-to-send', estadoEnvio: null }

  // One envelope's worth, split out so a batch the AEAT refuses WHOLESALE can
  // be sent again a record at a time -- see the caller below.
  const submit = async (
    registros: string[],
    attempts: { recordId: string; attempt: number; serieNumber: string }[],
  ): Promise<{ sent: number; estadoEnvio: string | null; schemaFault: boolean }> => {
    const envelope = buildRegFactuEnvelope({ obligado: built.obligado, registros })
    const sentAt = new Date().toISOString()

    let responseXml: string
    let httpStatus = 0
    try {
      const res = await postWithCertificate(
        verifactuEndpoint(effective.environment, effective.certificateType ?? 'representative'),
        envelope,
        effective,
      )
      httpStatus = res.status
      responseXml = res.body
    } catch (err) {
      // Nothing was judged, so nothing is known about the payload. Recorded as
      // its own status precisely so it is not mistaken for a rejection, and so
      // it does not set a pace that holds the retry back.
      await recordAttempts(supabase, accountId, attempts, {
        status: 'transport_error',
        sentAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      return { sent: 0, estadoEnvio: null, schemaFault: false }
    }

    const parsed = parseVerifactuResponse(responseXml)

    // A response with no EstadoEnvio is not a VERI*FACTU response: an error
    // page, a refusal, a gateway. Previously this fell through the per-record
    // loop, matched nothing, wrote nothing, and left the records owed with no
    // record of having tried -- indistinguishable from never having run.
    //
    // Recorded as a transport error, because that is what it is: the payload
    // was never judged. The status and the first of the body go in the message,
    // since the whole point is that somebody can read what came back.
    if (!parsed.estadoEnvio) {
      await recordAttempts(supabase, accountId, attempts, {
        status: 'transport_error',
        sentAt,
        errorMessage: `HTTP ${httpStatus}: response was not a VERI*FACTU answer: ${responseXml.slice(0, 300)}`,
      })
      return { sent: 0, estadoEnvio: null, schemaFault: true }
    }

    // Matched by serie number, which is what the AEAT echoes back. A line with
    // no match is not silently dropped -- it is left for the next run to retry,
    // because a record we cannot confirm was accepted is a record still owed.
    // The same rejection, every minute, is one fact and not fourteen hundred.
    //
    // Repeated transport errors were collapsed already; AEAT answers were not,
    // on the reasoning that no two are redundant. That holds for DIFFERENT
    // answers and fails badly for the same one: 21 records refused for the same
    // field grew this table by 145 rows in ten minutes, and would have added
    // thirty thousand a day. The same flood, wearing a different status.
    //
    // So an identical verdict on the same record refreshes its row. A verdict
    // that CHANGES -- rejected then accepted, or a different error -- is always
    // a new row, because that transition is the history worth keeping.
    const { data: existing } = await supabase
      .from('factura_record_submissions')
      .select('id, factura_record_id, status, error_code, repeats')
      .in('factura_record_id', attempts.map((a) => a.recordId))

    for (const attempt of attempts) {
      const line = parsed.lines.find((l) => l.serieNumber === attempt.serieNumber)
      if (!line?.estado) continue

      const same = (existing ?? []).find(
        (e) =>
          e.factura_record_id === attempt.recordId &&
          e.status === line.estado &&
          (e.error_code ?? null) === (line.errorCode ?? null),
      )
      if (same) {
        // error_message too, and it is not cosmetic. The row is matched on
        // status and error_code, so the SAME code arriving with a DIFFERENT
        // explanation refreshes this row -- and without this line it keeps the
        // explanation it was created with, for ever.
        //
        // That happened on 23 Sep and cost a wrong diagnosis. Sixteen F1s were
        // rejected 1239 for NIF:00000000T; the stand-in was then changed, they
        // were rejected 1239 again for a different reason entirely, and the
        // table still read "NIF:00000000T" -- a value the deployed code could
        // no longer produce. Only the rectificativas showed the true message,
        // and only because their code had changed from 1114, forcing a new
        // row. Reading the table honestly meant comparing created_at against
        // sent_at to work out that the text predated the code.
        //
        // The transport_error path a few lines down already updates it, so
        // this was an inconsistency rather than a rule.
        //
        // `repeats` is the one thing the collapse would otherwise destroy.
        // Folding identical verdicts into one row is what keeps this table
        // readable, but it also erases how many times the AEAT has said the
        // same thing -- and that count is the only honest signal for when to
        // stop asking. Counting rows cannot recover it: a record stuck on
        // 3002 for a day has exactly one 3002 row.
        await supabase
          .from('factura_record_submissions')
          .update({
            sent_at: sentAt,
            responded_at: new Date().toISOString(),
            wait_seconds: parsed.waitSeconds,
            error_message: line.errorMessage,
            repeats: (same.repeats ?? 1) + 1,
          })
          .eq('id', same.id)
        continue
      }

      await supabase.from('factura_record_submissions').insert({
        account_id: accountId,
        factura_record_id: attempt.recordId,
        attempt: attempt.attempt,
        status: line.estado,
        aeat_csv: parsed.csv,
        error_code: line.errorCode,
        error_message: line.errorMessage,
        wait_seconds: parsed.waitSeconds,
        sent_at: sentAt,
        responded_at: new Date().toISOString(),
      })
    }

    return {
      sent: parsed.lines.filter((l) => l.estado === 'Correcto' || l.estado === 'AceptadoConErrores').length,
      estadoEnvio: parsed.estadoEnvio,
      schemaFault: false,
    }
  }

  // A schema fault condemns the ENVELOPE, not every record inside it. The AEAT
  // validates the document before it judges anything in it, so one malformed
  // registro is answered with a SOAP Fault and NOTHING is evaluated -- the
  // valid records batched alongside it are refused for a defect they do not
  // have.
  //
  // #379 fixed the one that caused this: a Destinatarios block carrying a name
  // and no NIF. It took 27 records off the air when 22 were wrong, and among
  // the five it had no business touching were F2 simplificadas, which carry no
  // Destinatarios at all. The field is fixed; the amplification is not, and it
  // is the part that turns the next such mistake into an outage.
  //
  // So when the envelope comes back unjudged, send them again one at a time.
  // Nothing in a fault says WHICH record was malformed, so letting each earn
  // its own answer is also the only way to find out. The blast radius becomes
  // one record instead of the queue.
  //
  // Only on THIS outcome: a genuine transport failure means the service was
  // never reached, and retrying it once per record would multiply an outage
  // rather than isolate anything.
  const outcome = await submit(built.registros, built.attempts)
  if (!outcome.schemaFault || built.registros.length === 1) {
    return { sent: outcome.sent, parked, blocked: null, estadoEnvio: outcome.estadoEnvio }
  }

  let sent = 0
  let estadoEnvio: string | null = null
  for (let i = 0; i < built.registros.length; i++) {
    const one = await submit([built.registros[i]], [built.attempts[i]])
    sent += one.sent
    estadoEnvio = one.estadoEnvio ?? estadoEnvio
  }
  return { sent, parked, blocked: null, estadoEnvio }
}

/**
 * Writes one row per record for this attempt.
 *
 * A transport error that persists is NOT written every tick. The sender runs
 * every minute and an outage lasts as long as it lasts: 63 owed records times
 * 1,440 ticks is ninety thousand rows a day, all saying the same thing, in
 * the table whose job is to make the exceptional visible. So a repeated
 * transport error refreshes the existing row instead of adding to it -- the
 * evidence is that it is still failing, not how many times it has been tried.
 *
 * An answer FROM the AEAT is always a new row. Those are the fiscal record of
 * what was said about each registro, and none of them is redundant.
 */
async function recordAttempts(
  supabase: SupabaseClient<Database>,
  accountId: string,
  attempts: { recordId: string; attempt: number; serieNumber: string }[],
  outcome: { status: string; sentAt: string; errorMessage?: string },
) {
  if (outcome.status === 'transport_error') {
    const ids = attempts.map((a) => a.recordId)
    const { data: latest } = await supabase
      .from('factura_record_submissions')
      .select('factura_record_id, status')
      .in('factura_record_id', ids)
      .eq('status', 'transport_error')
    const alreadyFailing = new Set((latest ?? []).map((r) => r.factura_record_id))

    const fresh = attempts.filter((a) => !alreadyFailing.has(a.recordId))
    if (fresh.length === 0) {
      // Still broken, already on record. Refresh when it was last seen so the
      // row does not read as stale, and write nothing new.
      await supabase
        .from('factura_record_submissions')
        .update({ sent_at: outcome.sentAt, error_message: outcome.errorMessage ?? null })
        .in('factura_record_id', ids)
        .eq('status', 'transport_error')
      return
    }
    attempts = fresh
  }

  for (const a of attempts) {
    await supabase.from('factura_record_submissions').insert({
      account_id: accountId,
      factura_record_id: a.recordId,
      attempt: a.attempt,
      status: outcome.status,
      error_message: outcome.errorMessage ?? null,
      sent_at: outcome.sentAt,
    })
  }
}

/**
 * Turns pending records into RegistroAlta elements, in chain order.
 *
 * Reads each record's own stored values rather than recomputing anything: the
 * record is the fiscal artifact, and the huella it carries is what the AEAT
 * will check. Rebuilding those numbers from the factura would risk sending
 * something that disagrees with the hash.
 */
async function buildRecordsFor(
  supabase: SupabaseClient<Database>,
  accountId: string,
  pending: PendingRecord[],
  config: SenderConfig,
) {
  const ids = pending.map((p) => p.factura_record_id)
  const { data: records } = await supabase
    .from('factura_records')
    .select('id, factura_id, sequence, issuer_nif, serie_number, issued_on, invoice_type, cuota_total_cents, importe_total_cents, generated_at, previous_huella, huella')
    .in('id', ids)
    .order('sequence')

  const { data: clinic } = await supabase
    .from('clinics')
    .select('legal_name, name, tax_id')
    .eq('account_id', accountId)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  const { data: indicador } = await supabase.rpc('sif_indicador_multiples_ot')

  const facturaIds = (records ?? []).map((r) => r.factura_id)
  const { data: facturas } = await supabase
    .from('facturas')
    .select('id, patient_id, description, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, recipient_name, recipient_nif, rectifies_factura_id')
    .in('id', facturaIds)

  // The factura each rectificativa corrects, identified by its own RECORD
  // rather than by the factura row. FacturasRectificadas names the invoice the
  // way the AEAT knows it -- emisor, serie, date -- and the record is what was
  // actually transmitted under those three, so reading them from there cannot
  // drift from what the AEAT holds.
  const rectifiedIds = [...new Set((facturas ?? []).map((f) => f.rectifies_factura_id).filter(Boolean))] as string[]
  const { data: rectified } = rectifiedIds.length
    ? await supabase
        .from('factura_records')
        .select('factura_id, issuer_nif, serie_number, issued_on')
        .in('factura_id', rectifiedIds)
    : { data: [] as { factura_id: string; issuer_nif: string; serie_number: string; issued_on: string }[] }

  // The patient behind each factura, for the recipient name. A factura that
  // has not been delivered carries no frozen recipient -- the name resolves
  // from the patient at render time, and the record has to resolve it the
  // same way or it sends an empty NombreRazon and is refused.
  const patientIds = [...new Set((facturas ?? []).map((f) => f.patient_id).filter(Boolean))]
  const { data: patients } = patientIds.length
    ? await supabase.from('patients').select('id, first_name, last_name, national_id').in('id', patientIds)
    : { data: [] as { id: string; first_name: string; last_name: string | null; national_id: string | null }[] }

  const registros: string[] = []
  const attempts: { recordId: string; attempt: number; serieNumber: string }[] = []

  for (const r of records ?? []) {
    const f = (facturas ?? []).find((x) => x.id === r.factura_id)
    if (!f) continue

    // The predecessor in full: the AEAT re-walks the chain, so its huella
    // alone does not identify it.
    const { data: prev } = await supabase
      .from('factura_records')
      .select('issuer_nif, serie_number, issued_on')
      .eq('account_id', accountId)
      .lt('sequence', r.sequence)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle()

    registros.push(
      buildRegistroAlta({
        record: {
          issuerNif: r.issuer_nif,
          serieNumber: r.serie_number,
          issuedOn: r.issued_on,
          invoiceType: r.invoice_type,
          cuotaTotalCents: r.cuota_total_cents,
          importeTotalCents: r.importe_total_cents,
          generatedAt: r.generated_at,
          previousHuella: r.previous_huella,
          huella: r.huella,
        },
        previousRecord: prev ? { issuerNif: prev.issuer_nif, serieNumber: prev.serie_number, issuedOn: prev.issued_on } : null,
        factura: {
          description: f.description,
          taxBaseCents: f.tax_base_cents ?? 0,
          taxRateBp: f.tax_rate_bp ?? 0,
          taxAmountCents: f.tax_amount_cents ?? 0,
          taxExemptionCode: f.tax_exemption_code,
          recipientName: f.recipient_name,
          recipientNif: f.recipient_nif,
          patientName: (() => {
            const p = (patients ?? []).find((x) => x.id === f.patient_id)
            return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : null
          })(),
          patientNif: (patients ?? []).find((x) => x.id === f.patient_id)?.national_id ?? null,
        },
        rectifies: (() => {
          const o = (rectified ?? []).find((x) => x.factura_id === f.rectifies_factura_id)
          return o ? { issuerNif: o.issuer_nif, serieNumber: o.serie_number, issuedOn: o.issued_on } : null
        })(),
        issuerName: clinic?.legal_name || clinic?.name || '',
        accountId,
        indicadorMultiplesOt: (indicador as unknown as string) ?? 'S',
        // Nothing is flagged on a resend, and the omission IS the fix.
        //
        // This passed `afterRejection: p?.last_status === 'Incorrecto'`, which
        // put Subsanacion and RechazoPrevio on every record the AEAT had
        // refused. That pair says "amend the registro you hold"; the AEAT held
        // none of them, having rejected them, and answered 3002 "No existe el
        // registro de facturación" -- itself an Incorrecto, which set the flag
        // again on the next tick, and the one after. Twenty-two records
        // reached a state no future attempt could get them out of.
        //
        // A rejected record was never registered, so it goes again as an
        // ordinary alta carrying nothing. See `subsanacion` in registroAlta.ts
        // for the flag that remains, and what it is actually for.
        // Anything that is not production gets a stand-in destinatario. The
        // environment has only ever chosen the endpoint -- the document was
        // built the same either way -- so real patients were being identified
        // to the AEAT's test service. Defaulting on the NOT-production side is
        // the safe direction: a mistake leaves preproduction holding a name
        // nobody has, rather than production holding the wrong one.
        anonymiseRecipient: config.environment !== 'production',
      }),
    )

    // Attempt numbers continue from what the record already has, so a resend
    // is attempt 2 rather than colliding with attempt 1.
    const { count } = await supabase
      .from('factura_record_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('factura_record_id', r.id)
    attempts.push({ recordId: r.id, attempt: (count ?? 0) + 1, serieNumber: r.serie_number })
  }

  return {
    registros,
    attempts,
    obligado: { nif: clinic?.tax_id ?? '', nombreRazon: clinic?.legal_name || clinic?.name || '' },
  }
}
