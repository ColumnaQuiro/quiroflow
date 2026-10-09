// Fetches what utils/patientTimeline.ts turns into the record's activity
// timeline. Each source is read under the viewer's own RLS, so someone
// without inbox access simply has no WhatsApp rows in theirs -- the same as
// Reports > Communications, whose view (communications_log) is read here for
// every message the clinic sent.
import { buildPatientTimeline, type TimelineEvent, type TimelineSources } from '../utils/patientTimeline'
import { DEFAULT_CLINIC_TIMEZONE } from '../utils/clinicClock'

const PER_SOURCE = 40

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
    const [appts, sent, waIn, appIn, calls, plans, exercises, docs, invoices, team] = await Promise.all([
      supabase.from('appointments').select('id, starts_at, created_at, status, appointment_types(name)').eq('patient_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('communications_log').select('id, channel, kind, status, preview, sent_at').eq('patient_id', id).order('sent_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('whatsapp_messages').select('id, channel, created_at, body_preview').eq('patient_id', id).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('patient_app_messages').select('id, created_at, body').eq('patient_id', id).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('contact_log').select('id, action, note, created_at, created_by').eq('patient_id', id).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('care_plans').select('id, name, created_at, created_by, frequency_value, frequency_unit, visits_per_period, total_visits').eq('patient_id', id).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('patient_exercises').select('id, created_at, ended_at, assigned_by, exercises(name)').eq('patient_id', id).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('patient_docs').select('id, title, created_at, completed_at, created_by').eq('patient_id', id).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('invoices').select('id, created_at, invoice_number, status').eq('patient_id', id).order('created_at', { ascending: false }).limit(PER_SOURCE),
      supabase.from('team_members').select('id, full_name'),
    ])
    if (mine !== run) return
    const rows = <R>(r: { data: unknown }) => ((r.data as R[] | null) ?? [])
    const sources: TimelineSources = {
      now: new Date(),
      // The staff browser's zone unless told otherwise, as the calendar reads times.
      timeZone: timeZone() || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_CLINIC_TIMEZONE,
      staffNames: Object.fromEntries(rows<{ id: string; full_name: string | null }>(team).map((m) => [m.id, m.full_name ?? ''])),
      appointments: rows(appts),
      sent: rows(sent),
      received: [
        ...rows<{ id: string; channel: string | null; created_at: string; body_preview: string | null }>(waIn).map((m) => ({ id: m.id, channel: m.channel ?? 'whatsapp', at: m.created_at, preview: m.body_preview })),
        ...rows<{ id: string; created_at: string; body: string }>(appIn).map((m) => ({ id: m.id, channel: 'app', at: m.created_at, preview: m.body })),
      ],
      calls: rows(calls),
      plans: rows(plans),
      exercises: rows(exercises),
      documents: rows(docs),
      invoices: rows(invoices),
    }
    events.value = buildPatientTimeline(sources, t)
    loading.value = false
  }

  watch(patientId, () => load(), { immediate: true })
  return { events, loading, load }
}
