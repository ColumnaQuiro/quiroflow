<script setup lang="ts">
// Recent visits on the staff app's patient record, each with the opening of
// its visit note. Only rendered for a role with visit_notes_access (the page
// decides) -- and visit_notes is behind the same permission in RLS (0046), so
// the notes could not be read without it anyway.
//
// The note is matched by appointment_id, as the web's Clinical tab joins it,
// and its first line is read through parseVisitNote: a charted note is four
// labelled sections, and "Subjective: Pain 3/10…" would otherwise open with
// the label rather than with what was said.
const props = defineProps<{ patientId: string; timeZone: string }>()

const supabase = useSupabaseClient()
const t = useT()

interface VisitRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

const visits = ref<VisitRow[]>([])
const notes = ref<Record<string, string>>({})
const loading = ref(true)
const error = ref('')
const showAll = ref(false)
const PREVIEW_COUNT = 4
const LIST_LIMIT = 50

async function load() {
  error.value = ''
  // Visits that have happened (or should have): past, not cancelled, not
  // deleted on the calendar. A no-show stays -- it is part of the history.
  const { data, error: err } = await supabase
    .from('appointments')
    .select('id, starts_at, status, appointment_types(name)')
    .eq('patient_id', props.patientId)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .lt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (err) {
    error.value = t('Could not load the visits.', 'No se han podido cargar las visitas.')
    loading.value = false
    return
  }
  visits.value = (data as unknown as VisitRow[]) ?? []
  const ids = visits.value.map((v) => v.id)
  if (ids.length > 0) {
    const { data: rows } = await supabase.from('visit_notes').select('appointment_id, body, created_at').in('appointment_id', ids).order('created_at', { ascending: false })
    const byVisit: Record<string, string> = {}
    // Newest note per visit wins.
    for (const n of (rows as { appointment_id: string; body: string }[] | null) ?? []) {
      if (!(n.appointment_id in byVisit)) byVisit[n.appointment_id] = firstLine(n.body)
    }
    notes.value = byVisit
  }
  loading.value = false
}
onMounted(load)

function firstLine(body: string | null) {
  const parsed = parseVisitNote(body)
  const text = parsed.preamble || parsed.sections[0]?.text || ''
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

const shown = computed(() => (showAll.value ? visits.value : visits.value.slice(0, PREVIEW_COUNT)))

const locale = computed(() => t('en-GB', 'es-ES'))
function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', timeZone: props.timeZone })
}
function statusOf(v: VisitRow) {
  if (v.status === 'completed') return { label: t('Completed', 'Completada'), cls: 'text-success-text' }
  if (v.status === 'no_show') return { label: t('No-show', 'No asistió'), cls: 'text-danger-text' }
  return { label: t('Not logged', 'Sin registrar'), cls: 'text-warning-text' }
}
</script>

<template>
  <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3" data-cy="patient-visits">
    <div class="flex items-center justify-between">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('Recent visits', 'Visitas recientes') }}</h2>
      <button v-if="visits.length > PREVIEW_COUNT" type="button" class="text-[12.5px] font-medium text-brand-text" @click="showAll = !showAll">
        {{ showAll ? t('Fewer', 'Menos') : `${t('All', 'Todas')} ›` }}
      </button>
    </div>

    <div v-if="loading" class="mt-2.5 space-y-3">
      <div v-for="i in 3" :key="i" class="space-y-1.5">
        <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
        <UiSkeleton class="h-3 w-52 rounded-ctlSm" />
      </div>
    </div>
    <p v-else-if="error" class="mt-2 text-[13px] text-danger-text">{{ error }}</p>
    <p v-else-if="visits.length === 0" class="mt-1.5 text-[13px] text-ink-faint">{{ t('No visits yet.', 'Aún no hay visitas.') }}</p>
    <ul v-else class="mt-2 space-y-2.5">
      <li v-for="v in shown" :key="v.id">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-[13.5px] font-semibold text-ink-900">{{ dayLabel(v.starts_at) }}<template v-if="v.appointment_types?.name"> · {{ v.appointment_types.name }}</template></span>
          <span class="shrink-0 text-[12.5px]" :class="statusOf(v).cls">{{ statusOf(v).label }}</span>
        </div>
        <p v-if="notes[v.id]" class="mt-0.5 text-[12.5px] leading-snug text-ink-muted2" :class="showAll ? 'line-clamp-3' : 'line-clamp-1'">{{ notes[v.id] }}</p>
      </li>
    </ul>
  </section>
</template>
