import { clinicDateOf, nextDate, startOfLocalDate } from './clinicClock'

// How likely a patient is not to turn up, from what they have done before.
//
// Deliberately a rule a receptionist can say out loud ("missed 2 of her last
// 6"), not a score: it decides who gets a phone call before tomorrow, and a
// number nobody can explain gets ignored. Looks at the last twelve months of
// visits that have happened -- attended or missed. Cancelled ones are not
// counted either way: cancelling is what we want people to do instead.
//
//   high  missed two or more, or one in three of their visits
//   some  missed one
//   new   has never been in -- first visits are the ones most often missed
//   none  turns up
export type NoShowRiskLevel = 'high' | 'some' | 'new' | 'none'

export interface NoShowRisk {
  level: NoShowRiskLevel
  missed: number
  /** Visits that happened in the window: attended plus missed. */
  visits: number
}

export interface NoShowHistoryRow {
  patient_id: string
  starts_at: string
  status: string
}

const WINDOW_DAYS = 365

export function noShowRisk(history: { starts_at: string; status: string }[], now: Date): NoShowRisk {
  const from = now.getTime() - WINDOW_DAYS * 86_400_000
  let missed = 0
  let attended = 0
  for (const h of history) {
    const at = Date.parse(h.starts_at)
    if (at >= now.getTime() || at < from) continue
    if (h.status === 'no_show') missed++
    else if (h.status === 'completed') attended++
  }
  const visits = missed + attended
  const level: NoShowRiskLevel = missed >= 2 || (missed >= 1 && missed / visits >= 1 / 3)
    ? 'high'
    : missed === 1
      ? 'some'
      : visits === 0 ? 'new' : 'none'
  return { level, missed, visits }
}

/** Each patient's risk, from one query's rows for all of them. */
export function noShowRiskByPatient(rows: NoShowHistoryRow[], patientIds: string[], now: Date): Map<string, NoShowRisk> {
  const byPatient = new Map<string, NoShowHistoryRow[]>()
  for (const r of rows) {
    const list = byPatient.get(r.patient_id)
    if (list) list.push(r)
    else byPatient.set(r.patient_id, [r])
  }
  return new Map(patientIds.map((id) => [id, noShowRisk(byPatient.get(id) ?? [], now)]))
}

/** Riskiest first; the order the "needs confirming" list calls people in. */
export const NO_SHOW_RISK_RANK: Record<NoShowRiskLevel, number> = { high: 0, new: 1, some: 2, none: 3 }

/** "Missed 2 of 6", "First visit" -- why, in a few words. */
export function noShowRiskReason(r: NoShowRisk, t: (en: string, es: string) => string): string {
  if (r.level === 'new') return t('First visit', 'Primera visita')
  if (r.missed === 0) return ''
  return t(`Missed ${r.missed} of ${r.visits}`, `Faltó a ${r.missed} de ${r.visits}`)
}

/** How far ahead the list looks for visits to confirm: the rest of today and tomorrow, on the clinic's calendar. */
export function confirmWindowEnd(now: Date, timeZone: string): Date {
  const today = clinicDateOf(now, timeZone)
  return startOfLocalDate(nextDate(nextDate(today)), timeZone)
}
