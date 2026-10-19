import { listingSummary, sideLettersFor, type Listings } from '../utils/spinalListings'

// A patient's progress: their pain 0-10 visit by visit (visit_pain_scores,
// the practitioner's score over the patient's own when there are both),
// beside what was adjusted (visit_listings), and the care plan they are on.
// Read by the web record's Progreso tab (components/patients/ProgressTab) and
// the staff app's patient record (mobile/components/StaffPatientProgress),
// so the two never disagree about where someone started or where they are.
// Relative imports, not `~/`: inside the staff app `~` is mobile/.
export interface ProgressRow { id: string; startsAt: string; type: string | null; practitioner: string | null; score: number | null; byPatient: boolean; listing: string }

export function usePatientProgress(patientId: () => string) {
  const t = useT()
  const supabase = useSupabaseClient()
  const rows = ref<ProgressRow[]>([])
  const plan = ref<{ name: string; total: number; done: number } | null>(null)
  const loading = ref(true)

  async function load() {
    loading.value = true
    const { data: appts } = await supabase
      .from('appointments')
      .select('id, starts_at, appointment_types(name), team_members(full_name)')
      .eq('patient_id', patientId())
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .order('starts_at')
    const list = (appts as unknown as { id: string; starts_at: string; appointment_types: { name: string } | null; team_members: { full_name: string } | null }[] | null) ?? []
    const pain = new Map<string, { practitioner_score: number | null; patient_score: number | null }>()
    const listed = new Map<string, Listings>()
    const ids = list.map((a) => a.id)
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from('visit_pain_scores').select('appointment_id, practitioner_score, patient_score').in('appointment_id', chunk),
        supabase.from('visit_listings').select('appointment_id, listings').in('appointment_id', chunk),
      ])
      for (const r of (p as { appointment_id: string; practitioner_score: number | null; patient_score: number | null }[] | null) ?? []) pain.set(r.appointment_id, r)
      for (const r of (l as { appointment_id: string; listings: Listings }[] | null) ?? []) listed.set(r.appointment_id, r.listings)
    }
    const letters = sideLettersFor(t)
    rows.value = list.map((a) => {
      const s = pain.get(a.id)
      const score = s?.practitioner_score ?? s?.patient_score ?? null
      return { id: a.id, startsAt: a.starts_at, type: a.appointment_types?.name ?? null, practitioner: a.team_members?.full_name ?? null, score, byPatient: s?.practitioner_score == null && s?.patient_score != null, listing: listingSummary(listed.get(a.id), (x) => x, letters) }
    })

    const { data: cp } = await supabase.from('care_plans').select('name, total_visits, started_at').eq('patient_id', patientId()).order('started_at', { ascending: false }).limit(1).maybeSingle()
    const c = cp as { name: string; total_visits: number; started_at: string } | null
    const now = new Date().toISOString()
    plan.value = c ? { name: c.name, total: c.total_visits, done: list.filter((a) => a.starts_at >= c.started_at && a.starts_at <= now).length } : null
    loading.value = false
  }
  watch(patientId, load, { immediate: true })

  const scored = computed(() => rows.value.filter((r) => r.score !== null))
  const first = computed(() => scored.value[0]?.score ?? null)
  const latest = computed(() => scored.value[scored.value.length - 1]?.score ?? null)
  const change = computed(() => (first.value !== null && latest.value !== null && scored.value.length > 1 ? latest.value - first.value : null))

  return { rows, plan, loading, scored, first, latest, change, reload: load }
}
