import { MAX_REMINDERS_PER_DAY, nativeHabits, remindersPerDay, type Habit, type HabitPlace } from '../../utils/habits'
import { dayOf } from '../../utils/careStreak'

// "Mis hábitos" (Cuidarme): the patient's own reminders and places, kept on
// this phone only (localStorage, per signed-in person) and handed to the
// native scheduler on every change. What reaches QuiroFlow is each "Hecho"
// (habit_checkins): from the app, or from the notification's own button,
// which the native side keeps until the app opens (flush). A tick that
// cannot be sent now waits in a queue here and goes with the next flush;
// client_id makes a resend harmless.

interface Checkin { habit: string; done_at: string }

const storeKey = (userId: string, what: string) => `quiroflow.${what}.${userId}`
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: the reminders are still scheduled natively.
  }
}

export function useHabits(patientId: () => string) {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const reminders = useHabitReminders()
  const habits = useState<Habit[]>('habits', () => [])
  const places = useState<HabitPlace[]>('habit-places', () => [])
  const today = useState<Checkin[]>('habit-checkins-today', () => [])
  const accountId = ref<string | null>(null)
  const userId = computed(() => user.value?.sub ?? user.value?.id ?? '')

  function loadLocal() {
    if (!userId.value) return
    habits.value = read<Habit[]>(storeKey(userId.value, 'habits'), [])
    places.value = read<HabitPlace[]>(storeKey(userId.value, 'habit-places'), [])
  }

  /** Saves and reschedules. Refuses past the daily cap rather than dropping reminders silently. */
  async function save(nextHabits: Habit[], nextPlaces: HabitPlace[] = places.value): Promise<{ ok: true } | { error: string }> {
    if (remindersPerDay(nextHabits) > MAX_REMINDERS_PER_DAY) return { error: `Como mucho ${MAX_REMINDERS_PER_DAY} avisos al día entre todos tus hábitos.` }
    habits.value = nextHabits
    places.value = nextPlaces
    write(storeKey(userId.value, 'habits'), nextHabits)
    write(storeKey(userId.value, 'habit-places'), nextPlaces)
    await reminders.schedule(nativeHabits(nextHabits, nextPlaces), nextPlaces).catch((e) => console.error('[habits] schedule failed', e))
    return { ok: true }
  }

  async function loadToday() {
    const id = patientId()
    if (!id) return
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const [{ data }, { data: p }] = await Promise.all([
      supabase.from('habit_checkins').select('habit, done_at').eq('patient_id', id).gte('done_at', start.toISOString()),
      supabase.from('patients').select('account_id').eq('id', id).maybeSingle(),
    ])
    today.value = (data as Checkin[] | null) ?? []
    accountId.value = (p as { account_id: string } | null)?.account_id ?? null
  }

  const queueKey = () => storeKey(userId.value, 'habit-queue')

  /** Sends what is waiting: the queue here and the notification buttons' ticks. */
  async function flush() {
    const id = patientId()
    if (!id || !accountId.value || !userId.value) return
    const native = await reminders.takePendingCheckins().catch(() => [])
    const queued = read<{ habit: string; done_at: string; client_id: string }[]>(queueKey(), [])
    const kindOf = (habitId: string, fallback: string) => habits.value.find((h) => h.id === habitId)?.kind ?? fallback
    // The policy refuses ticks older than three days; one stale tick must not sink the batch.
    const fresh = (iso: string) => Date.now() - Date.parse(iso) < 3 * 86400_000 - 60_000
    const rows = [
      ...queued,
      ...native.map((c) => ({ habit: kindOf(c.habitId, c.kind), done_at: c.doneAt, client_id: c.clientId })),
    ].filter((r) => fresh(r.done_at))
    if (!rows.length) return write(queueKey(), [])
    const { error } = await supabase
      .from('habit_checkins')
      .upsert(rows.map((r) => ({ ...r, patient_id: id, account_id: accountId.value! })), { onConflict: 'patient_id,client_id', ignoreDuplicates: true })
    write(queueKey(), error ? rows : [])
    if (!error) await loadToday()
  }

  /** "Hecho" in the app. */
  async function tick(habit: Habit) {
    const row = { habit: habit.kind, done_at: new Date().toISOString(), client_id: crypto.randomUUID() }
    today.value = [...today.value, { habit: row.habit, done_at: row.done_at }]
    write(queueKey(), [...read(queueKey(), [] as typeof row[]), row])
    await flush()
  }

  /** Ticks of this habit today. Kinds are what is stored, so two habits of one kind share them. */
  const doneToday = (habit: Habit) => today.value.filter((c) => c.habit === habit.kind && dayOf(new Date(c.done_at)) === dayOf(new Date())).length

  watch(userId, loadLocal, { immediate: true })
  watch(patientId, async (id) => {
    if (!id) return
    await loadToday()
    await flush()
  }, { immediate: true })

  return { habits, places, today, save, tick, doneToday, flush, loadToday, reminders }
}
