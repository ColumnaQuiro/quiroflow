// "Cuidarme" in the patient app: the streak, the week and month at a glance,
// and the achievements, all worked out from the days the patient did
// something for themselves -- any home exercise ticked (patient_exercise_logs)
// or any habit ticked (habit_checkins). Days are 'YYYY-MM-DD' in the
// patient's own time zone; the caller turns timestamps into days. Shared by
// the patient app and the staff record, so it imports nothing.
//
// The rule that makes it humane: one missed day per week (Monday to Sunday)
// does not break the streak. It is a "día libre", shown as such. A second
// one in the same week does. Today does not count against anyone while it
// is still today.

export type Day = string

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: Day): number {
  const [y, m, d] = day.split('-').map(Number)
  return ((new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7) + 1
}

/** The Monday of the day's week: what makes two days "the same week". */
export function weekStart(day: Day): Day {
  return addDays(day, 1 - isoWeekday(day))
}

/** A Date's calendar day where it is read (the phone's own clock). */
export function dayOf(at: Date): Day {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

export interface Streak {
  /** Days done in the run that reaches today (or yesterday, today being still open). */
  current: number
  /** The free days inside that run, to draw them as such. */
  free: Day[]
  /** The longest run there has ever been. */
  best: number
}

/** Days done in the run ending on `end`, walking back, with its free days. */
function runEndingAt(active: Set<Day>, end: Day, earliest: Day): { count: number; free: Day[] } {
  let count = 0
  let oldestDone: Day | null = null
  const free: Day[] = []
  const usedWeeks = new Set<Day>()
  for (let d = end; d >= earliest; d = addDays(d, -1)) {
    if (active.has(d)) {
      count++
      oldestDone = d
      continue
    }
    const week = weekStart(d)
    if (usedWeeks.has(week)) break
    usedWeeks.add(week)
    free.push(d)
  }
  // A free day only counts between done days: one before the run began is
  // just a day before it began.
  return { count, free: oldestDone ? free.filter((f) => f > oldestDone!) : [] }
}

/** Every run, oldest first, as the day each run reached each length. */
function runs(active: Set<Day>, today: Day): { length: number; reached: Map<number, Day> }[] {
  const days = [...active].filter((d) => d <= today).sort()
  if (!days.length) return []
  const out: { length: number; reached: Map<number, Day> }[] = []
  let length = 0
  let reached = new Map<number, Day>()
  let usedWeeks = new Set<Day>()
  let pendingMiss = false
  for (let d = days[0]!; d <= today; d = addDays(d, 1)) {
    if (active.has(d)) {
      length++
      reached.set(length, d)
      pendingMiss = false
      continue
    }
    if (d === today) break
    const week = weekStart(d)
    if (!pendingMiss && !usedWeeks.has(week)) {
      usedWeeks.add(week)
      pendingMiss = true
      continue
    }
    if (length) out.push({ length, reached })
    length = 0
    reached = new Map()
    usedWeeks = new Set()
    pendingMiss = false
  }
  if (length) out.push({ length, reached })
  return out
}

export function careStreak(active: Set<Day>, today: Day): Streak {
  const all = runs(active, today)
  const best = Math.max(0, ...all.map((r) => r.length))
  if (!active.size) return { current: 0, free: [], best: 0 }
  const earliest = [...active].sort()[0]!
  const end = active.has(today) ? today : addDays(today, -1)
  const { count, free } = runEndingAt(active, end, earliest)
  return { current: count, free, best: Math.max(best, count) }
}

export type DayState = 'done' | 'free' | 'missed' | 'today' | 'future'

/** How to draw one day in the week strip or the month. */
export function dayState(day: Day, today: Day, active: Set<Day>, free: Day[]): DayState {
  if (active.has(day)) return 'done'
  if (day === today) return 'today'
  if (day > today) return 'future'
  return free.includes(day) ? 'free' : 'missed'
}

/** Monday to Sunday of today's week. */
export function thisWeek(today: Day): Day[] {
  const monday = weekStart(today)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export interface AchievementInput {
  active: Set<Day>
  today: Day
  /** Library or sent articles with a video that they opened. */
  videosWatched: number
  /** Articles their practitioner sent, and how many of those they opened. */
  sentTotal: number
  sentRead: number
  /** Pain 0-10 at the first scored visit and the latest. */
  painFirst: number | null
  painLatest: number | null
  painLatestOn?: Day | null
  /** Days on which every habit reminder of that day was ticked (worked out on the phone). */
  fullHabitDays?: Set<Day>
}

export interface Achievement {
  key: string
  title: string
  done: boolean
  /** When it was reached, if that is known. */
  on: Day | null
  /** Progress towards it while it is not done: [now, target]. */
  progress: [number, number] | null
  /** A line under the title: "De 7 a 3", "12 de 30". */
  detail: string | null
}

/** The longest run of consecutive days in a set, and the day it reached n. */
function consecutive(days: Set<Day>, today: Day, n: number): { best: number; current: number; reachedOn: Day | null } {
  const sorted = [...days].filter((d) => d <= today).sort()
  let best = 0
  let run = 0
  let prev: Day | null = null
  let reachedOn: Day | null = null
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    if (run > best) best = run
    if (run === n && !reachedOn) reachedOn = d
    prev = d
  }
  const current = prev && (prev === today || addDays(prev, 1) === today) ? run : 0
  return { best, current, reachedOn }
}

/**
 * Milestones, not points. Each says when it was reached or how far there is
 * to go; nothing compares one patient with another.
 */
export function achievements(input: AchievementInput): Achievement[] {
  const { active, today } = input
  const allRuns = runs(active, today)
  const streak = careStreak(active, today)
  const reachedRun = (n: number): Day | null => allRuns.find((r) => r.length >= n)?.reached.get(n) ?? null
  const doneDays = [...active].filter((d) => d <= today).sort()
  const first = doneDays[0] ?? null
  const sinceFirst = first ? Math.round((Date.parse(today) - Date.parse(first)) / 86400_000) : 0
  const habitRun = consecutive(input.fullHabitDays ?? new Set(), today, 7)

  const list: Achievement[] = []
  const add = (key: string, title: string, done: boolean, on: Day | null, now: number, target: number, detail?: string | null) =>
    list.push({ key, title, done, on: done ? on : null, progress: done ? null : [Math.min(now, target), target], detail: detail ?? (done ? null : `${Math.min(now, target)} de ${target}`) })

  add('primera_semana', 'Primera semana completa', streak.best >= 7, reachedRun(7), streak.best, 7)
  add('treinta_dias', '30 días seguidos', streak.best >= 30, reachedRun(30), Math.max(streak.current, 0), 30)
  if (input.painFirst !== null && input.painLatest !== null && input.painFirst >= 2) {
    const halved = input.painLatest * 2 <= input.painFirst
    list.push({ key: 'dolor_mitad', title: 'Dolor a la mitad', done: halved, on: halved ? (input.painLatestOn ?? null) : null, progress: null, detail: `De ${input.painFirst} a ${input.painLatest}` })
  }
  add('cinco_videos', '5 vídeos vistos', input.videosWatched >= 5, null, input.videosWatched, 5)
  add('habitos_semana', 'Una semana con todos tus hábitos', habitRun.best >= 7, habitRun.reachedOn, habitRun.current, 7, null)
  if (input.sentTotal > 0) add('todo_leido', 'Todo lo de tu profesional, leído', input.sentRead >= input.sentTotal, null, input.sentRead, input.sentTotal)
  add('cien_dias', '100 días cuidándote', doneDays.length >= 100, doneDays[99] ?? null, doneDays.length, 100)
  add('un_ano', 'Un año cuidándote', sinceFirst >= 365 && active.size > 0, first ? addDays(first, 365) : null, sinceFirst, 365, first && sinceFirst < 365 ? `Desde ${first}` : null)
  return list
}
