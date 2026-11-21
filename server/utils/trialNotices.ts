// The emails that tell a clinic its free trial is ending, has ended, and has
// turned read-only -- and the one that tells us, while there is still time to
// pick up the phone.
//
// Sent by trial-expiry-cron.post.ts, which already runs daily, so nothing new
// has to be scheduled against production. Each notice owns a window relative
// to trial_ends_at; a daily run sends the one whose window it is in, once
// (subscriptions.trial_notices_sent remembers), so a missed day is caught up
// by the next run and a run that repeats sends nothing twice.
//
// Pure: no Nuxt globals, so tests/unit holds the windows to their word.

import { TRIAL_GRACE_DAYS, trialGraceEndsAt } from '../../utils/billing'

export type TrialNotice = 'before_7' | 'before_3' | 'before_1' | 'ended' | 'grace_3' | 'grace_last' | 'read_only'

/** Sent to us (the signup notification address), not to the clinic. */
export const FOUNDER_NOTICE = 'founder_3'

const DAY_MS = 86_400_000

// Days left until trial_ends_at, as (from, to]: the notice is due while the
// time left is inside its window. Negative is time since it ended.
const WINDOWS: Array<{ notice: Exclude<TrialNotice, 'read_only'>; from: number; to: number }> = [
  { notice: 'before_7', from: 3, to: 7 },
  { notice: 'before_3', from: 1, to: 3 },
  { notice: 'before_1', from: 0, to: 1 },
  { notice: 'ended', from: -3, to: 0 },
  { notice: 'grace_3', from: -(TRIAL_GRACE_DAYS - 1), to: -3 },
  { notice: 'grace_last', from: -TRIAL_GRACE_DAYS, to: -(TRIAL_GRACE_DAYS - 1) },
]

/** The notice due now for a trial with no card, or null when none is, or it has gone already. */
export function dueTrialNotice(trialEndsAt: string, sent: readonly string[], now: Date = new Date()): TrialNotice | null {
  const daysLeft = (new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS
  const window = WINDOWS.find((w) => daysLeft > w.from && daysLeft <= w.to)
  if (!window || sent.includes(window.notice)) return null
  return window.notice
}

/** Whether to tell us about this trial: three days or fewer left, through the grace week, once. */
export function founderAlertDue(trialEndsAt: string, sent: readonly string[], now: Date = new Date()): boolean {
  if (sent.includes(FOUNDER_NOTICE)) return false
  const daysLeft = (new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS
  return daysLeft <= 3 && daysLeft > -TRIAL_GRACE_DAYS
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function longDate(iso: string | Date, language: 'es' | 'en'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
}

const SUBSCRIPTION_URL = 'https://app.quiroflow.com/subscription'

/** Subject and HTML of one notice, in the owner's language. */
export function trialNoticeEmail(
  notice: TrialNotice,
  opts: { language: 'es' | 'en'; ownerName: string | null; clinicName: string; trialEndsAt: string },
): { subject: string; html: string } {
  const es = opts.language === 'es'
  const ends = longDate(opts.trialEndsAt, opts.language)
  const graceEnds = longDate(trialGraceEndsAt(opts.trialEndsAt), opts.language)
  const firstName = (opts.ownerName ?? '').trim().split(/\s+/)[0] ?? ''
  const hello = es ? `Hola${firstName ? ` ${escapeHtml(firstName)}` : ''},` : `Hi${firstName ? ` ${escapeHtml(firstName)}` : ''},`
  const clinic = escapeHtml(opts.clinicName)

  const readOnlyMeans = es
    ? 'podrás seguir consultando la agenda, los historiales y las facturas, y exportar tus datos, pero no crear ni modificar citas, pacientes, notas ni facturas, y las reservas online quedarán en pausa'
    : 'you will still be able to see the diary, records and invoices, and export your data, but not create or change appointments, patients, notes or invoices, and online booking will pause'

  let subject: string
  let lines: string[]
  let cta = es ? 'Añadir tarjeta' : 'Add a card'

  switch (notice) {
    case 'before_7':
    case 'before_3':
    case 'before_1':
      subject = notice === 'before_1'
        ? (es ? 'Último día de tu prueba de QuiroFlow' : 'Last day of your QuiroFlow trial')
        : es ? `Tu prueba de QuiroFlow termina el ${ends}` : `Your QuiroFlow trial ends on ${ends}`
      lines = es
        ? [
            `La prueba gratuita de <strong>${clinic}</strong> termina el <strong>${ends}</strong>.`,
            'Si añades una tarjeta ahora, no se cobra nada hasta ese día y no se interrumpe nada: todo sigue exactamente igual.',
          ]
        : [
            `The free trial for <strong>${clinic}</strong> ends on <strong>${ends}</strong>.`,
            'Add a card now and nothing is charged until that day, and nothing is interrupted: everything carries on exactly as it is.',
          ]
      break
    case 'ended':
      subject = es ? 'Tu prueba de QuiroFlow ha terminado' : 'Your QuiroFlow trial has ended'
      lines = es
        ? [
            `La prueba gratuita de <strong>${clinic}</strong> terminó el ${ends}. Todo sigue funcionando hasta el <strong>${graceEnds}</strong>.`,
            `Después, la cuenta pasará a modo solo lectura: ${readOnlyMeans}.`,
            `Añade una tarjeta antes del ${graceEnds} y no notarás nada. El pago cuenta desde el ${ends}, el día que terminó la prueba.`,
          ]
        : [
            `The free trial for <strong>${clinic}</strong> ended on ${ends}. Everything keeps working until <strong>${graceEnds}</strong>.`,
            `After that the account becomes read-only: ${readOnlyMeans}.`,
            `Add a card before ${graceEnds} and you will notice nothing. Billing counts from ${ends}, the day the trial ended.`,
          ]
      break
    case 'grace_3':
      subject = es ? `El ${graceEnds} tu cuenta de QuiroFlow pasa a solo lectura` : `On ${graceEnds} your QuiroFlow account becomes read-only`
      lines = es
        ? [
            `Tu prueba terminó el ${ends}. El <strong>${graceEnds}</strong> la cuenta de <strong>${clinic}</strong> pasará a modo solo lectura: ${readOnlyMeans}.`,
            'Añade una tarjeta y todo sigue igual.',
          ]
        : [
            `Your trial ended on ${ends}. On <strong>${graceEnds}</strong> the account for <strong>${clinic}</strong> becomes read-only: ${readOnlyMeans}.`,
            'Add a card and everything stays as it is.',
          ]
      break
    case 'grace_last':
      subject = es ? 'Mañana tu cuenta de QuiroFlow pasa a solo lectura' : 'Tomorrow your QuiroFlow account becomes read-only'
      lines = es
        ? [
            `Mañana la cuenta de <strong>${clinic}</strong> pasará a modo solo lectura: ${readOnlyMeans}.`,
            'Si añades la tarjeta hoy, mañana todo seguirá funcionando.',
          ]
        : [
            `Tomorrow the account for <strong>${clinic}</strong> becomes read-only: ${readOnlyMeans}.`,
            'Add the card today and everything keeps working tomorrow.',
          ]
      break
    case 'read_only':
      subject = es ? 'Tu cuenta de QuiroFlow está en modo solo lectura' : 'Your QuiroFlow account is read-only'
      cta = es ? 'Reactivar la cuenta' : 'Reactivate the account'
      lines = es
        ? [
            `La cuenta de <strong>${clinic}</strong> está ahora en modo solo lectura. Tus datos siguen ahí, intactos: puedes consultarlos y exportarlos cuando quieras.`,
            'Para volver a crear y modificar citas, pacientes, notas y facturas, y reactivar las reservas online, añade una tarjeta. Todo vuelve a funcionar al momento.',
          ]
        : [
            `The account for <strong>${clinic}</strong> is now read-only. Your data is all still there: you can see it and export it whenever you like.`,
            'To create and change appointments, patients, notes and invoices again, and switch online booking back on, add a card. Everything works again straight away.',
          ]
      break
  }

  const help = es
    ? '¿Dudas, o necesitas unos días más? Escríbenos a hola@quiroflow.com.'
    : 'Questions, or need a few more days? Write to hola@quiroflow.com.'

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#15171E">
      <p style="font-size:15px;line-height:1.55">${hello}</p>
      ${lines.map((l) => `<p style="font-size:15px;line-height:1.55">${l}</p>`).join('\n      ')}
      <p style="margin:22px 0">
        <a href="${SUBSCRIPTION_URL}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 18px;border-radius:8px">${cta}</a>
      </p>
      <p style="font-size:13px;line-height:1.55;color:#6B7180">${help}</p>
    </div>`

  return { subject, html }
}

function row(label: string, value: string) {
  return `<tr><td style="padding:4px 14px 4px 0;color:#6B7180;font-size:13px">${label}</td><td style="padding:4px 0;color:#15171E;font-size:13px">${value}</td></tr>`
}

/** To us: a trial about to end with no card, and what the clinic has done with it -- enough to decide whether to call. */
export function founderTrialAlertEmail(opts: {
  clinicName: string
  ownerName: string | null
  ownerEmail: string | null
  ownerPhone: string | null
  trialEndsAt: string
  signedUpAt: string | null
  patients: number
  appointments: number
  lastSignInAt: string | null
}): { subject: string; html: string } {
  const ends = longDate(opts.trialEndsAt, 'es')
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif">
      <p style="font-size:15px;color:#15171E">Prueba sin tarjeta: <strong>${escapeHtml(opts.clinicName)}</strong> termina el ${ends}.</p>
      <table style="border-collapse:collapse;margin-top:8px">
        ${row('Propietario', escapeHtml(opts.ownerName ?? '—'))}
        ${row('Email', escapeHtml(opts.ownerEmail ?? '—'))}
        ${row('Teléfono', escapeHtml(opts.ownerPhone ?? '—'))}
        ${row('Alta', opts.signedUpAt ? longDate(opts.signedUpAt, 'es') : '—')}
        ${row('Pacientes', String(opts.patients))}
        ${row('Citas', String(opts.appointments))}
        ${row('Último acceso', opts.lastSignInAt ? longDate(opts.lastSignInAt, 'es') : '—')}
        ${row('Pasa a solo lectura', longDate(trialGraceEndsAt(opts.trialEndsAt), 'es'))}
      </table>
    </div>`
  return { subject: `Prueba sin tarjeta: ${opts.clinicName} termina el ${ends}`, html }
}
