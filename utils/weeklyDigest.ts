import { GOAL_LABELS, goalPace, goalValue, type GoalProgress } from './monthlyGoals'
import { formatEur } from './billing'
import { isReceipt } from './paymentReceipts'
import { clinicDateOf, localDay } from './clinicClock'

// The owner's Monday summary of last week (server/utils/weeklyDigest.ts sends
// it): money in, by how it was paid; what was invoiced and what is still owed;
// visits, no-shows and cancellations; new patients; and next week's diary.
// Each figure beside the week before it.
//
// Money is counted the way Reports > Daily Transactions counts it: a payment is
// money in when it is a receipt (utils/paymentReceipts -- spent credit and
// write-offs are not) and its invoice is not void. A refund is the negative
// payment it is, so it comes off.
export interface DigestPayment { amount_cents: number; method: string; invoice_status: string | null }
export interface DigestVisit { status: string }

export interface DigestWeek {
  collectedCents: number
  /** Receipts, refunds included. */
  payments: number
  byMethod: { method: string; cents: number }[]
  invoicedCents: number
  completed: number
  noShows: number
  cancelled: number
  newPatients: number
}

export function digestWeek(input: { payments: DigestPayment[]; invoicedCents: number; visits: DigestVisit[]; newPatients: number }): DigestWeek {
  const receipts = input.payments.filter((p) => p.invoice_status !== 'void' && isReceipt(p.method))
  const by = new Map<string, number>()
  for (const p of receipts) by.set(p.method, (by.get(p.method) ?? 0) + p.amount_cents)
  return {
    collectedCents: receipts.reduce((s, p) => s + p.amount_cents, 0),
    payments: receipts.length,
    byMethod: [...by].map(([method, cents]) => ({ method, cents })).filter((m) => m.cents !== 0).sort((a, b) => b.cents - a.cents),
    invoicedCents: input.invoicedCents,
    completed: input.visits.filter((v) => v.status === 'completed').length,
    noShows: input.visits.filter((v) => v.status === 'no_show').length,
    cancelled: input.visits.filter((v) => v.status === 'cancelled').length,
    newPatients: input.newPatients,
  }
}

/** Of the visits that were due to happen (attended or missed), the share missed. */
export function digestNoShowRate(w: Pick<DigestWeek, 'completed' | 'noShows'>): number | null {
  const due = w.completed + w.noShows
  return due ? Math.round((w.noShows / due) * 100) : null
}

/** "+12 %" / "−3" against the week before; '' when there is nothing to compare. */
export function digestChange(now: number, before: number, opts: { money?: boolean } = {}): string {
  if (now === before) return '='
  const diff = now - before
  const sign = diff > 0 ? '+' : '−'
  if (opts.money) return before ? `${sign}${Math.abs(Math.round((diff / Math.abs(before)) * 100))} %` : `${sign}${formatEur(Math.abs(diff))}`
  return `${sign}${Math.abs(diff)}`
}

export interface DigestEmail {
  clinicName: string
  weekLabel: string
  thisWeek: DigestWeek
  lastWeek: DigestWeek
  /** Unpaid now, across every patient (patient_live_balances.outstanding_cents). */
  owedCents: number
  nextWeekBooked: number
  methodName: (key: string) => string
  /** The app's origin, for the links to the reports. */
  origin: string
  /** This month's goals so far (utils/monthlyGoals.ts), when the owner set any. */
  goals?: { monthLabel: string; elapsed: number; items: GoalProgress[] }
}

/** The push: one line, the headline figures. */
export function digestPushBody(d: Pick<DigestEmail, 'thisWeek' | 'lastWeek'>): string {
  const w = d.thisWeek
  const rate = digestNoShowRate(w)
  return [
    `Cobrado ${formatEur(w.collectedCents)} (${digestChange(w.collectedCents, d.lastWeek.collectedCents, { money: true })})`,
    `${w.completed} visitas`,
    rate !== null ? `${rate} % no vinieron` : null,
    w.newPatients ? `${w.newPatients} ${w.newPatients === 1 ? 'paciente nuevo' : 'pacientes nuevos'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function digestEmailHtml(d: DigestEmail): string {
  const w = d.thisWeek
  const b = d.lastWeek
  const rate = digestNoShowRate(w)
  const before = digestNoShowRate(b)
  const row = (label: string, value: string, delta: string, link?: string) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #EEF0F4;color:#3A3F52;font-size:14px">${link ? `<a href="${d.origin}${link}" style="color:#3A3F52;text-decoration:none">${esc(label)}</a>` : esc(label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EEF0F4;text-align:right;font-size:15px;font-weight:600;color:#15171E">${esc(value)}</td>
      <td style="padding:8px 0 8px 12px;border-bottom:1px solid #EEF0F4;text-align:right;font-size:12.5px;color:#6B7183;white-space:nowrap">${esc(delta)}</td>
    </tr>`
  const methods = w.byMethod.length
    ? w.byMethod.map((m) => `<tr><td style="padding:4px 0 4px 14px;color:#6B7183;font-size:13px">${esc(d.methodName(m.method))}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#3A3F52">${esc(formatEur(m.cents))}</td><td></td></tr>`).join('')
    : ''
  return `<!doctype html><html><body style="margin:0;background:#F6F7F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border:1px solid #E6E8EE;border-radius:14px;padding:24px">
      <p style="margin:0;color:#4F46E5;font-size:13px;font-weight:600">${esc(d.clinicName)}</p>
      <h1 style="margin:6px 0 2px;font-size:22px;color:#15171E">Tu semana</h1>
      <p style="margin:0 0 16px;color:#6B7183;font-size:13.5px">${esc(d.weekLabel)} · comparado con la semana anterior</p>
      <h2 style="margin:16px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6B7183">Dinero</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        ${row('Cobrado', formatEur(w.collectedCents), digestChange(w.collectedCents, b.collectedCents, { money: true }), '/reports/daily-transactions')}
        ${methods}
        ${row('Pagos recibidos', String(w.payments), digestChange(w.payments, b.payments))}
        ${row('Facturado', formatEur(w.invoicedCents), digestChange(w.invoicedCents, b.invoicedCents, { money: true }), '/reports/income')}
        ${row('Pendiente de cobro hoy', formatEur(d.owedCents), '', '/reports/debtors')}
      </table>
      <h2 style="margin:20px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6B7183">Pacientes</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        ${row('Visitas realizadas', String(w.completed), digestChange(w.completed, b.completed), '/reports/statistics')}
        ${row('No vinieron', `${w.noShows}${rate !== null ? ` (${rate} %)` : ''}`, digestChange(w.noShows, b.noShows) + (before !== null && rate !== null ? ` · antes ${before} %` : ''))}
        ${row('Cancelaciones', String(w.cancelled), digestChange(w.cancelled, b.cancelled))}
        ${row('Pacientes nuevos', String(w.newPatients), digestChange(w.newPatients, b.newPatients), '/reports/retention')}
        ${row('Citas reservadas para esta semana', String(d.nextWeekBooked), '', '/calendar')}
      </table>
      ${d.goals?.items.length ? `<h2 style="margin:20px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6B7183">Objetivos de ${esc(d.goals.monthLabel)}</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        ${d.goals.items.map((g) => row(GOAL_LABELS[g.metric][1], `${goalValue(g.metric, g.actual)} / ${goalValue(g.metric, g.target)}`, GOAL_PACE_ES[goalPace(g, d.goals!.elapsed)], '/dashboard')).join('')}
      </table>` : ''}
      <p style="margin:20px 0 0"><a href="${d.origin}/reports" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:9px">Ver los informes</a></p>
    </div>
    <p style="margin:14px 4px 0;color:#9097A6;font-size:12px">Lo recibes por ser propietario de ${esc(d.clinicName)} en QuiroFlow. Puedes desactivarlo en la app: Perfil &gt; Avisos &gt; Resumen semanal.</p>
  </div></body></html>`
}

const GOAL_PACE_ES = { done: 'Conseguido', on_track: 'En camino', behind: 'Por detrás' } as const

/** Monday, from 8:00 to 8:20 where the clinic is: the cron's window (it runs every 15 minutes). */
export function digestDue(now: Date, timeZone: string): boolean {
  const day = clinicDateOf(now, timeZone)
  if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 1) return false
  const m = localDay(now, timeZone).minutesSinceMidnight
  return m >= 8 * 60 && m < 8 * 60 + 20
}
