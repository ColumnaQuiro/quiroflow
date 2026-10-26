// What the VeriFactu alert says and when it fires. Pure, so the decisions are
// unit-tested; server/utils/verifactuAlerts.ts does the reading and sending.
import type { BlockedReason } from './verifactuSoap'

/**
 * How long a record may go unaccepted before someone is told.
 *
 * Fifteen minutes. The sender runs every minute and a healthy record is
 * acknowledged on the first tick, so anything still owed after fifteen has
 * failed several times over -- and a refused record parks after ten identical
 * answers (20260923171056), so it has stopped being retried by then too.
 * Shorter would catch the AEAT's own pacing (TiempoEsperaEnvio) and the
 * one-tick recovery of a record refused for its predecessor.
 */
export const VERIFACTU_ALERT_AFTER_MINUTES = 15

/** Certificate warnings, in days before expiry. Each fires once. */
export const VERIFACTU_CERTIFICATE_ALERT_DAYS = [30, 7] as const

export interface UnacceptedRecord {
  id: string
  serieNumber: string
  generatedAt: string
  environment: 'test' | 'production'
  lastStatus: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  parked: boolean
}

/**
 * The records to alert about now: unaccepted for longer than the threshold,
 * and not alerted before. In chain order, as they came in.
 */
export function verifactuRecordsToAlert(records: UnacceptedRecord[], alreadyAlerted: Set<string>, now: Date): UnacceptedRecord[] {
  const cutoff = now.getTime() - VERIFACTU_ALERT_AFTER_MINUTES * 60_000
  return records.filter((r) => !alreadyAlerted.has(r.id) && new Date(r.generatedAt).getTime() <= cutoff)
}

/**
 * The key a certificate warning is stored under, or null when none is due.
 * The tightest threshold it has crossed: a certificate first seen at 5 days
 * left gets the 7-day warning, not the 30-day one as well.
 */
export function verifactuCertificateAlertKey(notAfter: string, daysLeft: number): string | null {
  const crossed = [...VERIFACTU_CERTIFICATE_ALERT_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d)
  return crossed === undefined ? null : `${notAfter}:${crossed}`
}

// Why nothing is going out, in words an owner can act on. Only the reasons
// that persist: pacing and an empty queue are the sender working normally.
const BLOCKED_ES: Partial<Record<BlockedReason, string>> = {
  'no-certificate': 'No hay ningún certificado subido en Ajustes → VeriFactu.',
  'no-certificate-type': 'El certificado subido no se reconoce como certificado de representante ni de sello.',
  'certificate-expired': 'El certificado ha caducado. Sube uno nuevo en Ajustes → VeriFactu.',
  'no-passphrase': 'Falta la contraseña del certificado. Vuelve a subirlo con su contraseña en Ajustes → VeriFactu.',
  'no-platform-key': 'El servidor no puede abrir la contraseña guardada del certificado (falta o cambió NUXT_VERIFACTU_SECRET_KEY).',
  'no-producer-nif': 'Falta el NIF del productor del sistema.',
  'no-platform-certificate': 'QuiroFlow envía por esta clínica, pero la plataforma no tiene certificado subido.',
  'delegation-not-accepted': 'QuiroFlow envía por esta clínica, pero la autorización ante la AEAT aún no se ha confirmado.',
}

export function verifactuBlockedReasonEs(reason: BlockedReason | null | undefined): string | null {
  return reason ? (BLOCKED_ES[reason] ?? null) : null
}

function describeAnswer(r: UnacceptedRecord): string {
  if (!r.lastStatus) return 'Aún no se ha enviado.'
  const code = r.lastErrorCode ? ` ${r.lastErrorCode}` : ''
  const message = r.lastErrorMessage ? `: ${r.lastErrorMessage}` : ''
  const parked = r.parked ? ' Rechazado 10 veces seguidas: ya no se reintenta.' : ''
  return `${r.lastStatus}${code}${message}.${parked}`
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function madridTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function verifactuRecordsAlertEmail(input: { clinicName: string; records: UnacceptedRecord[]; blocked: BlockedReason | null; settingsUrl: string }): { subject: string; html: string } {
  const n = input.records.length
  const real = input.records.some((r) => r.environment === 'production')
  const subject = `VeriFactu: ${n === 1 ? 'un registro' : `${n} registros`} sin aceptar por la AEAT en ${input.clinicName}`
  const blocked = verifactuBlockedReasonEs(input.blocked)
  const rows = input.records
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;white-space:nowrap"><strong>${escapeHtml(r.serieNumber)}</strong></td>` +
        `<td style="padding:6px 12px 6px 0;white-space:nowrap;color:#555">${escapeHtml(madridTime(r.generatedAt))}${r.environment === 'test' ? ' · prueba' : ''}</td>` +
        `<td style="padding:6px 0">${escapeHtml(describeAnswer(r))}</td></tr>`,
    )
    .join('')
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">',
    `<p>La AEAT no ha aceptado ${n === 1 ? 'este registro de facturación' : 'estos registros de facturación'} de <strong>${escapeHtml(input.clinicName)}</strong> pasados ${VERIFACTU_ALERT_AFTER_MINUTES} minutos desde que se generaron.</p>`,
    real
      ? '<p><strong>Son registros reales:</strong> la normativa exige remitirlos a la AEAT, así que conviene revisarlo hoy.</p>'
      : '<p>Son registros del entorno de pruebas de la AEAT; no tienen efecto fiscal, pero el mismo fallo afectaría a los reales.</p>',
    blocked ? `<p><strong>Por qué no se envía nada:</strong> ${escapeHtml(blocked)}</p>` : '',
    `<table style="border-collapse:collapse;font-size:13px">${rows}</table>`,
    `<p><a href="${escapeHtml(input.settingsUrl)}">Abrir Ajustes → VeriFactu</a></p>`,
    '<p style="color:#777;font-size:12px">Te avisamos una sola vez por registro.</p>',
    '</div>',
  ].join('')
  return { subject, html }
}

export function verifactuCertificateAlertEmail(input: { clinicName: string; subject: string | null; notAfter: string; daysLeft: number; settingsUrl: string }): { subject: string; html: string } {
  const expired = input.daysLeft < 0
  const when = new Date(input.notAfter).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' })
  const subject = expired
    ? `VeriFactu: el certificado de ${input.clinicName} ha caducado`
    : `VeriFactu: el certificado de ${input.clinicName} caduca en ${input.daysLeft} días`
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">',
    expired
      ? `<p>El certificado con el que <strong>${escapeHtml(input.clinicName)}</strong> remite sus registros a la AEAT caducó el ${escapeHtml(when)}. No se está enviando nada hasta que se suba uno nuevo.</p>`
      : `<p>El certificado con el que <strong>${escapeHtml(input.clinicName)}</strong> remite sus registros a la AEAT caduca el <strong>${escapeHtml(when)}</strong>. A partir de esa fecha no se enviará nada hasta que se suba uno nuevo.</p>`,
    input.subject ? `<p style="color:#555;font-size:12px">${escapeHtml(input.subject)}</p>` : '',
    `<p><a href="${escapeHtml(input.settingsUrl)}">Subir el certificado renovado en Ajustes → VeriFactu</a></p>`,
    '</div>',
  ].join('')
  return { subject, html }
}
