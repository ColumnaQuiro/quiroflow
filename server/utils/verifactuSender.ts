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
import { Agent } from 'node:https'
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
    certificatePassphrase: runtime.verifactuCertificatePassphrase || undefined,
    certificateType: runtime.verifactuCertificateType === 'seal' ? 'seal' : 'representative',
  }
}

interface PendingRecord {
  factura_record_id: string
  sequence: number
  serie_number: string
  last_status: string | null
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
): Promise<{ sent: number; blocked: BlockedReason | null; estadoEnvio: string | null }> {
  const { data: pendingRaw } = await supabase.rpc('factura_records_awaiting_aeat', { p_account_id: accountId })
  const pending = ((pendingRaw ?? []) as PendingRecord[]).slice(0, MAX_RECORDS_PER_SUBMISSION)

  const { data: readyAtRaw } = await supabase.rpc('factura_submission_ready_at', { p_account_id: accountId })
  const readyAt = new Date((readyAtRaw as unknown as string) ?? Date.now())

  // The store wins over anything configured by hand. Configuration is the
  // developer's escape hatch; the store is where a renewed certificate lands,
  // and a stale env var silently taking precedence over it is the bug this
  // ordering prevents.
  const stored = await certificateFor(supabase, accountId)
  const effective: SenderConfig = stored ? { ...config, ...stored } : config

  const blocked = transmissionBlockedBy({ config: effective, pendingCount: pending.length, readyAt })
  if (blocked) return { sent: 0, blocked, estadoEnvio: null }

  const built = await buildRecordsFor(supabase, accountId, pending)
  if (built.registros.length === 0) return { sent: 0, blocked: 'nothing-to-send', estadoEnvio: null }

  const envelope = buildRegFactuEnvelope({ obligado: built.obligado, registros: built.registros })
  const sentAt = new Date().toISOString()

  let responseXml: string
  try {
    const res = await fetch(verifactuEndpoint(effective.environment, effective.certificateType ?? 'representative'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      body: envelope,
      // @ts-expect-error -- undici accepts a dispatcher/agent; typed loosely here
      agent: buildAgent(effective),
    })
    responseXml = await res.text()
  } catch (err) {
    // Nothing was judged, so nothing is known about the payload. Recorded as
    // its own status precisely so it is not mistaken for a rejection, and so
    // it does not set a pace that holds the retry back.
    await recordAttempts(supabase, accountId, built.attempts, {
      status: 'transport_error',
      sentAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return { sent: 0, blocked: null, estadoEnvio: null }
  }

  const parsed = parseVerifactuResponse(responseXml)

  // Matched by serie number, which is what the AEAT echoes back. A line with
  // no match is not silently dropped -- it is left for the next run to retry,
  // because a record we cannot confirm was accepted is a record still owed.
  for (const attempt of built.attempts) {
    const line = parsed.lines.find((l) => l.serieNumber === attempt.serieNumber)
    if (!line?.estado) continue
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
    blocked: null,
    estadoEnvio: parsed.estadoEnvio,
  }
}

async function recordAttempts(
  supabase: SupabaseClient<Database>,
  accountId: string,
  attempts: { recordId: string; attempt: number; serieNumber: string }[],
  outcome: { status: string; sentAt: string; errorMessage?: string },
) {
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
    .select('id, description, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, recipient_name, recipient_nif')
    .in('id', facturaIds)

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

    const p = pending.find((x) => x.factura_record_id === r.id)
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
        },
        issuerName: clinic?.legal_name || clinic?.name || '',
        accountId,
        indicadorMultiplesOt: (indicador as unknown as string) ?? 'S',
        // A record the AEAT rejected was never registered there, so it goes
        // again as an ordinary alta -- flagged, so the resend reads as
        // deliberate rather than as a duplicate.
        afterRejection: p?.last_status === 'Incorrecto',
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
