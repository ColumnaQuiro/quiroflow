<script setup lang="ts">
import { computePresetRange, rangeBounds, type DateRangePreset } from '~/composables/useDateRangePresets'

interface ApptRow { id: string; patient_id: string; starts_at: string; appointment_type_id: string | null }
interface TypeRow { id: string; stage: string | null }
interface PaymentRow { amount_cents: number; paid_at: string }

const PRESETS: DateRangePreset[] = [
  { label: 'This month', months: 1 },
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
]

const supabase = useSupabaseClient()

const range = ref(computePresetRange({ months: 3 }))
const loading = ref(true)
const allCompleted = ref<ApptRow[]>([]) // every completed appointment, all-time — several metrics need full patient history
const types = ref<TypeRow[]>([])
const payments = ref<PaymentRow[]>([])

const PAGE_SIZE = 1000
async function fetchAll<T>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; ; page++) {
    let query = supabase.from(table).select(select).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (filter) query = filter(query)
    const { data } = await query
    rows.push(...((data as T[]) ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function load() {
  loading.value = true
  const [completed, typeRows] = await Promise.all([
    fetchAll<ApptRow>('appointments', 'id, patient_id, starts_at, appointment_type_id', (q) => q.eq('status', 'completed')),
    supabase.from('appointment_types').select('id, stage').then((r) => r.data ?? []),
  ])
  allCompleted.value = completed.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  types.value = typeRows

  const { from, to } = rangeBounds(range.value)
  const { data: p } = await supabase.from('payments').select('amount_cents, paid_at').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString())
  payments.value = p ?? []

  loading.value = false
}
onMounted(load)
watch(range, load)

const stageById = computed(() => new Map(types.value.map((t) => [t.id, t.stage])))

const rangeStart = computed(() => rangeBounds(range.value).from)
const rangeEnd = computed(() => rangeBounds(range.value).to)
const inRange = computed(() => allCompleted.value.filter((a) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value))

function countByStage(stage: string) {
  return inRange.value.filter((a) => stageById.value.get(a.appointment_type_id ?? '') === stage).length
}

const firstVisits = computed(() => countByStage('first_visit'))
const firstVisitOffers = computed(() => countByStage('first_visit_offer'))
const reports = computed(() => countByStage('report'))
const maintenance = computed(() => countByStage('maintenance'))

// Ordinal revision count needs each patient's FULL history (not just the
// range) to know which occurrence is "1st" vs "2nd" -- then we count how
// many of those land inside the selected range.
const revisionOrdinals = computed(() => {
  const byPatient = new Map<string, ApptRow[]>()
  for (const a of allCompleted.value) {
    if (stageById.value.get(a.appointment_type_id ?? '') !== 'revision') continue
    const list = byPatient.get(a.patient_id) ?? []
    list.push(a)
    byPatient.set(a.patient_id, list)
  }
  const inWindow = (a: ApptRow) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value
  let revision1 = 0
  let revision2 = 0
  for (const list of byPatient.values()) {
    if (list[0] && inWindow(list[0])) revision1++
    if (list[1] && inWindow(list[1])) revision2++
  }
  return { revision1, revision2 }
})

// Retention after a revision: of patients whose most recent revision falls
// in this range, did they go on to book/attend anything after it?
const postRevisionRetention = computed(() => {
  const lastRevisionByPatient = new Map<string, ApptRow>()
  for (const a of allCompleted.value) {
    if (stageById.value.get(a.appointment_type_id ?? '') !== 'revision') continue
    lastRevisionByPatient.set(a.patient_id, a) // sorted ascending, so last write wins = most recent
  }
  const inRangeRevisions = [...lastRevisionByPatient.entries()].filter(([, a]) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value)
  if (inRangeRevisions.length === 0) return null
  const retained = inRangeRevisions.filter(([patientId, revisionAppt]) =>
    allCompleted.value.some((a) => a.patient_id === patientId && a.id !== revisionAppt.id && new Date(a.starts_at) > new Date(revisionAppt.starts_at)),
  ).length
  return Math.round((retained / inRangeRevisions.length) * 100)
})

// Conversion: of patients whose very first-ever visit falls in this range,
// what fraction went on to a 3rd visit (regardless of when).
const conversion = computed(() => {
  const firstByPatient = new Map<string, ApptRow>()
  const countByPatient = new Map<string, number>()
  for (const a of allCompleted.value) {
    countByPatient.set(a.patient_id, (countByPatient.get(a.patient_id) ?? 0) + 1)
    if (!firstByPatient.has(a.patient_id)) firstByPatient.set(a.patient_id, a)
  }
  const newInRange = [...firstByPatient.entries()].filter(([, a]) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value)
  if (newInRange.length === 0) return null
  const converted = newInRange.filter(([patientId]) => (countByPatient.get(patientId) ?? 0) >= 3).length
  return { pct: Math.round((converted / newInRange.length) * 100), newPatients: newInRange.length, converted }
})

// Overall retention: of patients seen in this range, how many had also
// been seen before it started (i.e. are returning, not brand new).
const retentionRate = computed(() => {
  const beforeRange = new Set(allCompleted.value.filter((a) => new Date(a.starts_at) < rangeStart.value).map((a) => a.patient_id))
  const patientsInRange = new Set(inRange.value.map((a) => a.patient_id))
  if (patientsInRange.size === 0) return null
  const returning = [...patientsInRange].filter((id) => beforeRange.has(id)).length
  return Math.round((returning / patientsInRange.size) * 100)
})

const pva = computed(() => {
  const totalCents = payments.value.reduce((sum, p) => sum + p.amount_cents, 0)
  if (inRange.value.length === 0) return null
  return totalCents / 100 / inRange.value.length
})

const unclassifiedTypes = computed(() => types.value.filter((t) => !t.stage).length)
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Statistics</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Visit-type counts, conversion, and retention.</p>

    <p v-if="!loading && unclassifiedTypes > 0" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      {{ unclassifiedTypes }} appointment type(s) aren't tagged with a stage yet, so visits of that type won't show up
      below. Assign one in
      <NuxtLink to="/settings/appointment-types" class="font-medium underline">Settings &rarr; Appointment Types</NuxtLink>.
    </p>

    <div class="mt-4">
      <ReportsDateRangeSelect v-model="range" :presets="PRESETS" />
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

    <template v-else>
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ firstVisits }}</p>
          <p class="text-xs text-gray-500">First visits</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ firstVisitOffers }}</p>
          <p class="text-xs text-gray-500">First visit offers</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ reports }}</p>
          <p class="text-xs text-gray-500">Reports</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ maintenance }}</p>
          <p class="text-xs text-gray-500">Maintenance visits</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ revisionOrdinals.revision1 }}</p>
          <p class="text-xs text-gray-500">Revision 1</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ revisionOrdinals.revision2 }}</p>
          <p class="text-xs text-gray-500">Revision 2</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ pva !== null ? `€${pva.toFixed(2)}` : '—' }}</p>
          <p class="text-xs text-gray-500">PVA (avg. revenue / visit)</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ inRange.length }}</p>
          <p class="text-xs text-gray-500">Total completed visits</p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Conversion to 3rd visit</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ conversion ? `${conversion.pct}%` : '—' }}</p>
          <p v-if="conversion" class="text-xs text-gray-400">{{ conversion.converted }} of {{ conversion.newPatients }} new patients this period</p>
          <p v-else class="text-xs text-gray-400">No new patients seen this period yet.</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Retention post-revision</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ postRevisionRetention !== null ? `${postRevisionRetention}%` : '—' }}</p>
          <p class="text-xs text-gray-400">Booked something after their revision visit</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Overall retention</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</p>
          <p class="text-xs text-gray-400">Of patients seen this period, % also seen before it</p>
        </div>
      </div>

      <p class="mt-4 text-xs text-gray-400">
        Package/bono sales are tracked separately — see
        <NuxtLink to="/reports/debtors" class="underline">Debtors</NuxtLink> and
        <NuxtLink to="/reports/memberships" class="underline">Memberships</NuxtLink>.
      </p>
    </template>
  </div>
</template>
