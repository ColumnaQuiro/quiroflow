import { achievements, careStreak, dayOf, isoWeekday, type Day } from '../../utils/careStreak'
import { remindersOn } from '../../utils/habits'

// Cuidarme's streak, week, month and achievements for the signed-in patient
// (utils/careStreak.ts does the counting). A day counts when they ticked a
// home exercise (patient_exercise_logs) or a habit (habit_checkins); both are
// read under the patient's own RLS. Pain comes from my_pain_trend, since
// patients cannot read visit_pain_scores themselves.

export function useCareProgress(patientId: () => string) {
  const supabase = useSupabaseClient()
  const { habits } = useHabits(patientId)
  const active = ref<Set<Day>>(new Set())
  const habitTicks = ref<{ habit: string; day: Day }[]>([])
  const learn = ref({ videosWatched: 0, sentTotal: 0, sentRead: 0 })
  const pain = ref<{ first: number | null; latest: number | null; latestOn: Day | null }>({ first: null, latest: null, latestOn: null })
  const loaded = ref(false)

  async function load() {
    const id = patientId()
    if (!id) return
    // A year and a bit: enough for "un año cuidándote" and any streak worth showing.
    const since = new Date(Date.now() - 400 * 86400_000)
    const [ex, hb, ls, pt] = await Promise.all([
      supabase.from('patient_exercise_logs').select('done_on, patient_exercises!inner(patient_id)').eq('patient_exercises.patient_id', id).gte('done_on', since.toISOString().slice(0, 10)),
      supabase.from('habit_checkins').select('habit, done_at').eq('patient_id', id).gte('done_at', since.toISOString()),
      supabase.from('learn_sends').select('opened_at, channel, learn_articles(video_url, media_path)').eq('patient_id', id),
      supabase.rpc('my_pain_trend'),
    ])
    const days = new Set<Day>()
    for (const r of (ex.data as { done_on: string }[] | null) ?? []) days.add(r.done_on)
    const ticks = ((hb.data as { habit: string; done_at: string }[] | null) ?? []).map((r) => ({ habit: r.habit, day: dayOf(new Date(r.done_at)) }))
    for (const tk of ticks) days.add(tk.day)
    active.value = days
    habitTicks.value = ticks
    const sends = (ls.data as unknown as { opened_at: string | null; channel: string | null; learn_articles: { video_url: string | null; media_path: string | null } | null }[] | null) ?? []
    const sent = sends.filter((s) => s.channel !== 'library')
    learn.value = {
      videosWatched: sends.filter((s) => s.opened_at && (s.learn_articles?.video_url || s.learn_articles?.media_path)).length,
      sentTotal: sent.length,
      sentRead: sent.filter((s) => s.opened_at).length,
    }
    const p = ((pt.data as { first_score: number | null; latest_score: number | null; latest_on: string | null }[] | null) ?? [])[0]
    pain.value = { first: p?.first_score ?? null, latest: p?.latest_score ?? null, latestOn: p?.latest_on ?? null }
    loaded.value = true
  }

  const today = computed(() => dayOf(new Date()))
  const streak = computed(() => careStreak(active.value, today.value))

  // A day with every habit reminder of that day ticked, by today's settings.
  const fullHabitDays = computed(() => {
    const enabled = habits.value.filter((h) => h.enabled)
    if (!enabled.length) return new Set<Day>()
    const byDay = new Map<Day, Map<string, number>>()
    for (const tk of habitTicks.value) {
      const m = byDay.get(tk.day) ?? new Map()
      m.set(tk.habit, (m.get(tk.habit) ?? 0) + 1)
      byDay.set(tk.day, m)
    }
    const full = new Set<Day>()
    for (const [day, counts] of byDay) {
      const wd = isoWeekday(day)
      const due = new Map<string, number>()
      for (const h of enabled) due.set(h.kind, (due.get(h.kind) ?? 0) + remindersOn(h, wd))
      if ([...due].every(([kind, n]) => (counts.get(kind) ?? 0) >= n) && [...due.values()].some((n) => n > 0)) full.add(day)
    }
    return full
  })

  const list = computed(() =>
    achievements({
      active: active.value,
      today: today.value,
      ...learn.value,
      painFirst: pain.value.first,
      painLatest: pain.value.latest,
      painLatestOn: pain.value.latestOn,
      fullHabitDays: fullHabitDays.value,
    }),
  )

  watch(patientId, (id) => id && load(), { immediate: true })
  return { active, streak, today, achievements: list, loaded, load, habitTicks }
}
