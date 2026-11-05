// "Mis hábitos" in the patient app (Cuidarme): the reminders a patient sets
// for themselves, and when exactly they go off. The phone keeps them and
// schedules them (mobile/composables/useHabits.ts and the native
// HabitReminders plugin); only each "Hecho" reaches QuiroFlow
// (habit_checkins). Shared and pure, so it imports nothing.

export type HabitKind = 'agua' | 'estirar' | 'respirar' | 'postura' | 'levantarse' | 'otro'
export type HabitDays = 'all' | 'weekdays' | 'weekend'

export interface Habit {
  id: string
  kind: HabitKind
  /** What the reminder says; the kind's own line when empty. */
  label: string
  message: string
  timesPerDay: number
  /** 'HH:MM', the first and the last reminder of the day. */
  from: string
  to: string
  days: HabitDays
  enabled: boolean
  /** Only while the phone is at one of these places; empty = anywhere. */
  placeIds: string[]
}

export interface HabitPlace {
  id: string
  name: string
  lat: number
  lng: number
  /** Metres around the point that count as "there". */
  radius: number
  address: string
}

export type Lang = 'en' | 'es'

/** Each kind's own name and reminder line, [English, Spanish]. */
export const HABIT_KINDS: Record<HabitKind, { label: [string, string]; message: [string, string] }> = {
  agua: { label: ['Drink water', 'Beber agua'], message: ['A glass of water now.', 'Un vaso de agua ahora.'] },
  estirar: { label: ['Stop and stretch', 'Parar y estirar'], message: ['Two minutes: neck and back.', 'Dos minutos: cuello y espalda.'] },
  respirar: { label: ['Stop and breathe', 'Parar y respirar'], message: ['Five slow breaths, from the belly.', 'Cinco respiraciones lentas, con la tripa.'] },
  postura: { label: ['Posture in the chair', 'Postura en la silla'], message: ['Back against the backrest, feet on the floor.', 'Espalda contra el respaldo, pies en el suelo.'] },
  levantarse: { label: ['Get up', 'Levantarme'], message: ['Get up and walk for a minute.', 'Levántate y camina un minuto.'] },
  otro: { label: ['My habit', 'Mi hábito'], message: ["It's time.", 'Es la hora.'] },
}
const pick = (pair: [string, string], lang: Lang) => (lang === 'en' ? pair[0] : pair[1])

/**
 * At most this many reminders a day, all habits together. Not a taste
 * limit: iOS keeps only 64 scheduled notifications per app, and a habit on
 * weekdays only takes five of them for each time of day, so 12 a day is
 * what always fits (12 x 5 = 60).
 */
export const MAX_REMINDERS_PER_DAY = 12

export const DEFAULT_PLACE_RADIUS = 150

export function newHabit(kind: HabitKind, id: string): Habit {
  return { id, kind, label: '', message: '', timesPerDay: kind === 'agua' || kind === 'respirar' ? 5 : 2, from: '09:00', to: kind === 'respirar' ? '21:00' : '19:00', days: 'all', enabled: true, placeIds: [] }
}

export const kindLabel = (kind: HabitKind, lang: Lang = 'es') => pick(HABIT_KINDS[kind].label, lang)
export const habitLabel = (h: Habit, lang: Lang = 'es') => h.label.trim() || kindLabel(h.kind, lang)
export const habitMessage = (h: Habit, lang: Lang = 'es') => h.message.trim() || pick(HABIT_KINDS[h.kind].message, lang)

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/**
 * The times of day, spread evenly from the first to the last and rounded to
 * five minutes: 5 between 09:00 and 19:00 is 09:00, 11:30, 14:00, 16:30,
 * 19:00. One a day is at `from`.
 */
export function habitTimes(h: Pick<Habit, 'timesPerDay' | 'from' | 'to'>): string[] {
  const n = Math.max(1, Math.min(MAX_REMINDERS_PER_DAY, Math.round(h.timesPerDay)))
  const a = toMin(h.from)
  const b = Math.max(a, toMin(h.to))
  if (n === 1) return [toHHMM(a)]
  const step = (b - a) / (n - 1)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const t = Math.round((a + i * step) / 5) * 5
    const s = toHHMM(Math.min(t, 23 * 60 + 55))
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/** ISO weekdays, 1 = Monday ... 7 = Sunday. */
export function habitWeekdays(days: HabitDays): number[] {
  return days === 'weekdays' ? [1, 2, 3, 4, 5] : days === 'weekend' ? [6, 7] : [1, 2, 3, 4, 5, 6, 7]
}

export const DAYS_LABEL: Record<HabitDays, [string, string]> = { all: ['every day', 'todos los días'], weekdays: ['Monday to Friday', 'lunes a viernes'], weekend: ['weekends', 'fin de semana'] }

/** Reminders a day, all enabled habits together, for the cap. */
export function remindersPerDay(habits: Habit[]): number {
  return habits.filter((h) => h.enabled).reduce((n, h) => n + habitTimes(h).length, 0)
}

/** "5 al día · 9 a 19 h · lunes a viernes". */
export function habitSummary(h: Habit, lang: Lang = 'es'): string {
  const en = lang === 'en'
  const times = habitTimes(h)
  const hours = (s: string) => (s.endsWith(':00') ? String(Number(s.slice(0, 2))) : s.replace(/^0/, ''))
  const when = times.length === 1 ? `${en ? 'at' : 'a las'} ${hours(times[0]!)}` : times.length === 2 ? `${times.map((t) => t.replace(/^0/, '')).join(en ? ' and ' : ' y ')}` : `${hours(h.from)} ${en ? 'to' : 'a'} ${hours(h.to)} h`
  return `${times.length} ${en ? 'a day' : 'al día'} · ${when} · ${pick(DAYS_LABEL[h.days], lang)}`
}

/**
 * What the native scheduler is handed: a plain list of reminders, each with
 * its times, weekdays and the places it is limited to.
 */
export interface NativeHabit {
  id: string
  kind: HabitKind
  title: string
  body: string
  times: string[]
  weekdays: number[]
  placeIds: string[]
}

export function nativeHabits(habits: Habit[], places: HabitPlace[], lang: Lang = 'es'): NativeHabit[] {
  const known = new Set(places.map((p) => p.id))
  return habits
    .filter((h) => h.enabled)
    .map((h) => ({ id: h.id, kind: h.kind, title: habitLabel(h, lang), body: habitMessage(h, lang), times: habitTimes(h), weekdays: habitWeekdays(h.days), placeIds: h.placeIds.filter((id) => known.has(id)) }))
}

/** How many reminders of a habit fall on a day, for "2/5" on Cuidarme. */
export function remindersOn(h: Habit, isoWeekday: number): number {
  return h.enabled && habitWeekdays(h.days).includes(isoWeekday) ? habitTimes(h).length : 0
}
