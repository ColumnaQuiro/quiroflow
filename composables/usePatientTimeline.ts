// Fetches what utils/patientTimeline.ts turns into the record's activity
// timeline. Each source is read under the viewer's own RLS (patient_timeline
// is a security-invoker function), so someone without inbox access simply
// has no WhatsApp rows in theirs -- the same as Reports > Communications,
// whose view (communications_log) is read here for every message the clinic
// sent.
import { buildPatientTimeline, type TimelineEvent, type TimelineSources } from '../utils/patientTimeline'
import { DEFAULT_CLINIC_TIMEZONE } from '../utils/clinicClock'

const PER_SOURCE = 40

/** What patient_timeline returns: each source's rows, as the selects returned them. */
interface TimelinePayload {
  appointments: TimelineSources['appointments']
  sent: TimelineSources['sent']
  whatsapp_inbound: { id: string; channel: string | null; created_at: string; body_preview: string | null }[]
  app_inbound: { id: string; created_at: string; body: string }[]
  calls: TimelineSources['calls']
  plans: TimelineSources['plans']
  exercises: TimelineSources['exercises']
  documents: TimelineSources['documents']
  invoices: TimelineSources['invoices']
  team_members: { id: string; full_name: string | null }[]
}

export function usePatientTimeline(patientId: () => string, timeZone: () => string | null | undefined) {
  const supabase = useSupabaseClient()
  const t = useT()
  const events = ref<TimelineEvent[]>([])
  const loading = ref(true)

  let run = 0
  async function load(opts: { silent?: boolean } = {}) {
    const id = patientId()
    if (!id) return
    const mine = ++run
    if (!opts.silent) loading.value = true
    // One request (patient_timeline, 20261111192000) where there were ten, one
    // per source: fired together they queued behind each other on the
    // database. The function returns the same rows, read under the viewer's
    // own policies, and the merging stays in utils/patientTimeline.ts.
    const { data, error } = await supabase.rpc('patient_timeline' as never, { p_patient_id: id, p_limit: PER_SOURCE } as never)
    if (mine !== run) return
    // A failed read leaves every source empty, as ten failed reads did; the
    // layout's toast says a query failed.
    const got = ((error ? null : data) ?? {}) as unknown as Partial<TimelinePayload>
    const sources: TimelineSources = {
      now: new Date(),
      // The staff browser's zone unless told otherwise, as the calendar reads times.
      timeZone: timeZone() || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_CLINIC_TIMEZONE,
      staffNames: Object.fromEntries((got.team_members ?? []).map((m) => [m.id, m.full_name ?? ''])),
      appointments: got.appointments ?? [],
      sent: got.sent ?? [],
      received: [
        ...(got.whatsapp_inbound ?? []).map((m) => ({ id: m.id, channel: m.channel ?? 'whatsapp', at: m.created_at, preview: m.body_preview })),
        ...(got.app_inbound ?? []).map((m) => ({ id: m.id, channel: 'app', at: m.created_at, preview: m.body })),
      ],
      calls: got.calls ?? [],
      plans: got.plans ?? [],
      exercises: got.exercises ?? [],
      documents: got.documents ?? [],
      invoices: got.invoices ?? [],
    }
    events.value = buildPatientTimeline(sources, t)
    loading.value = false
  }

  watch(patientId, () => load(), { immediate: true })
  return { events, loading, load }
}
