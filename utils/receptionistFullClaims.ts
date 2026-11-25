// "Nothing free" checked against the free times the receptionist was given.
//
// On 24 Nov 2026 a patient asked for a morning visit and Alba answered "Por
// la mañana no tenemos huecos en las próximas dos semanas" -- and, asked
// again, "ningún hueco antes del martes 15 de diciembre". Thursday 26 Nov
// from 12:00 to 13:00 was free with Natacha, a whole first visit, and it was
// in the list of free times the prompt gave her. Making her look the days up
// again would not have helped: find_free_times returns the same list. What
// does is reading her sentence back against that list in code: a reply that
// calls a day, a week or a part of the day full while the list has a time in
// it goes back once with those times named (receptionistModel.ts).
//
// Only a claim that can be checked is read: one naming the dates it covers
// ("hasta el 14 de diciembre", "en las próximas dos semanas", "el lunes 30")
// and not naming a chiropractor or a clock time, since the lists merge the
// team's times and a sentence with a time in it is usually offering one. A
// claim is contradicted only when every list (one per kind of visit) has a
// time in it: "no morning for a first visit" is not refuted by a free
// fifteen-minute adjustment.

import { shiftDate } from '~/utils/automationTriggerMatch'

/** The free times one list of the model's covered: the prompt's, or one find_free_times answer. */
export interface FreeTimesSource {
  /** First clinic date covered, YYYY-MM-DD. */
  from: string
  /** Last clinic date covered, YYYY-MM-DD. */
  to: string
  /** One per kind of visit: its days with free starts ("09:30"), and where the list was cut short. */
  groups: { days: { date: string; times: string[] }[]; truncatedAfter: string | null }[]
  /** Narrowed to one chiropractor or to someone else in the family (find_free_times' chiropractor / for_name). */
  scoped?: boolean
}

export type PartOfDay = 'morning' | 'afternoon'

export interface NoFreeTimeClaim {
  /** The sentence as written, for the note. */
  sentence: string
  part: PartOfDay | null
  /** First and last clinic dates the claim covers. */
  from: string
  to: string
}

/** Morning ends here: "por la mañana" at a clinic open 9:00-14:00. */
const AFTERNOON_FROM = '14:00'

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const WEEKDAY = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)'
const MONTH = `(${Object.keys(MONTHS).join('|')})`
const COUNTS: Record<string, number> = { una: 1, un: 1, '1': 1, dos: 2, '2': 2, tres: 3, '3': 3, cuatro: 4, '4': 4 }

// "no tenemos huecos", "no me queda nada", "no hay ninguna hora", "está completo", "sin huecos".
const NOTHING_FREE = new RegExp(
  [
    `\\bno (?:nos |me |te )?(?:tenemos|tengo|hay|queda|quedan|encuentro|veo)\\b[^.!?\\n]{0,60}?\\b(?:huecos?|horas?|nada|sitio|disponibilidad|citas? libres?)\\b`,
    `\\b(?:esta|estamos|estan) (?:completos?|completas?|llenos?|llenas?)\\b`,
    `\\bsin huecos?\\b`,
  ].join('|'),
)
const MORNING = /\b(?:por|de) la manana\b|\b(?:las )?mananas\b|\ba primera hora\b/
const AFTERNOON = /\b(?:por|de) la tarde\b|\b(?:las )?tardes\b|\ba ultima hora\b/
const CLOCK = /\b\d{1,2}[:.]\d{2}\b|\ba las? \d{1,2}\b/

/** Lower case, accents off: "Miércoles" and "miercoles" read the same. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Day `d` of month `m` (or of this month or the next, when no month is named), on or after today. */
function upcomingDate(today: string, d: number, m: number | null): string | null {
  if (d < 1 || d > 31) return null
  const [y, tm, td] = today.split('-').map(Number) as [number, number, number]
  const candidates = m
    ? [[y, m], [y + 1, m]]
    : d >= td ? [[y, tm], [tm === 12 ? y + 1 : y, tm === 12 ? 1 : tm + 1]] : [[tm === 12 ? y + 1 : y, tm === 12 ? 1 : tm + 1]]
  for (const [cy, cm] of candidates) {
    const at = new Date(Date.UTC(cy!, cm! - 1, d))
    if (at.getUTCMonth() !== cm! - 1) continue
    const date = at.toISOString().slice(0, 10)
    if (date >= today) return date
  }
  return null
}

/** The Sunday ending the week `date` is in (Monday to Sunday). */
function endOfWeek(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return shiftDate(date, (7 - weekday) % 7)
}

/** The dates a sentence's claim covers, from today; null when it names none. */
function claimDates(s: string, today: string): { from: string; to: string } | null {
  const until = new RegExp(`\\b(hasta|antes)\\s+(?:el|del?)\\s+(?:dia\\s+)?(?:${WEEKDAY}\\s+)?(\\d{1,2})(?:\\s+de\\s+${MONTH})?\\b`).exec(s)
  if (until) {
    const date = upcomingDate(today, Number(until[2]), until[3] ? MONTHS[until[3]]! : null)
    if (!date) return null
    const to = until[1] === 'antes' ? shiftDate(date, -1) : date
    return to >= today ? { from: today, to } : null
  }
  const weeks = /\b(?:en )?(?:las|estas) (?:proximas )?(una|un|1|dos|2|tres|3|cuatro|4) semanas\b|\b(?:en )?las proximas semanas\b/.exec(s)
  if (weeks) return { from: today, to: shiftDate(today, 7 * (weeks[1] ? COUNTS[weeks[1]]! : 2) - 1) }
  if (/\bla (?:semana que viene|proxima semana)\b/.test(s)) {
    const monday = shiftDate(endOfWeek(today), 1)
    return { from: monday, to: shiftDate(monday, 6) }
  }
  if (/\besta semana\b/.test(s)) return { from: today, to: endOfWeek(today) }
  const on = new RegExp(`\\b${WEEKDAY}\\s+(\\d{1,2})(?:\\s+de\\s+${MONTH})?\\b|\\bel\\s+(\\d{1,2})\\s+de\\s+${MONTH}\\b`).exec(s)
  if (on) {
    const date = on[1] ? upcomingDate(today, Number(on[1]), on[2] ? MONTHS[on[2]]! : null) : upcomingDate(today, Number(on[3]), MONTHS[on[4]!]!)
    return date ? { from: date, to: date } : null
  }
  return null
}

/**
 * The first sentence of a Spanish reply saying nothing is free over dates it
 * names, or null. `teamNames` are first names: a claim about one
 * chiropractor cannot be checked against lists that merge the team's times.
 */
export function noFreeTimeClaim(text: string, today: string, teamNames: string[] = []): NoFreeTimeClaim | null {
  const names = teamNames.map((name) => plain(name).split(/\s+/)[0]).filter((name): name is string => Boolean(name && name.length > 1))
  for (const sentence of text.split(/(?<=[.!?\n])\s*/)) {
    const s = plain(sentence)
    if (!NOTHING_FREE.test(s) || s.includes('?') || CLOCK.test(s)) continue
    if (names.some((name) => new RegExp(`\\b${name}\\b`).test(s))) continue
    const dates = claimDates(s, today)
    if (!dates) continue
    const part = MORNING.test(s) ? 'morning' : AFTERNOON.test(s) ? 'afternoon' : null
    return { sentence: sentence.trim(), part, ...dates }
  }
  return null
}

/**
 * Free times that prove `claim` wrong, from the first list that has one on
 * every kind of visit within the claim's dates and part of the day -- at
 * most three, earliest first -- or null when nothing contradicts it.
 */
export function contradictingTimes(claim: NoFreeTimeClaim, sources: FreeTimesSource[]): { date: string; time: string }[] | null {
  const fits = (time: string) => !claim.part || (claim.part === 'morning' ? time < AFTERNOON_FROM : time >= AFTERNOON_FROM)
  for (const source of sources) {
    const from = claim.from > source.from ? claim.from : source.from
    const to = claim.to < source.to ? claim.to : source.to
    if (from > to || source.groups.length === 0) continue
    const perGroup = source.groups.map((group) =>
      group.days
        .filter((day) => day.date >= from && day.date <= to && (!group.truncatedAfter || day.date <= group.truncatedAfter))
        .flatMap((day) => day.times.filter(fits).map((time) => ({ date: day.date, time }))),
    )
    if (perGroup.some((found) => found.length === 0)) continue
    const fewest = perGroup.reduce((a, b) => (b.length < a.length ? b : a))
    return [...fewest].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3)
  }
  return null
}

/** Sends a reply calling free dates full back to be written again. */
export function fullClaimNote(claim: NoFreeTimeClaim, found: { date: string; time: string }[]): string {
  const label = (date: string) => `${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })} ${date}`
  const times = found.map((f) => `${label(f.date)} at ${f.time}`).join(', ')
  return `Your reply says "${claim.sentence}", but the free times you were given include ${times}${claim.part ? ` -- in the ${claim.part}` : ''}, within those dates. Never call a day, a week or a part of the day full while the list has a time in it. Write the reply again: offer the earliest of those times that suit them, without saying anything was full.`
}
