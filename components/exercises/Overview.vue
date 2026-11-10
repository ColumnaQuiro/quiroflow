<script setup lang="ts">
import type { Json } from '~/types/database.types'
import type { PatientSelection } from '~/composables/usePatientTypes'

// The Exercises section's first tab: every active patient with their home
// exercises, their types and how their last seven days went, so a clinic can
// see who has nothing, who is not doing them, and act on many at once
// instead of opening records one by one.
//
// The list is patients_matching with the section's own filters (types,
// exercises on or not, app), paged by PostgREST like the Patients list; the
// row details come from patient_exercise_overview for the page shown. A
// selection is either the rows ticked or "all N that match", which the bulk
// functions read back from the same filters.
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { showToast } = useToast()
const types = usePatientTypes()
onMounted(types.load)

const PAGE = 50
const page = ref(0)
const q = ref('')
const appliedQ = ref('')
let qTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(qTimer)
  qTimer = setTimeout(() => (appliedQ.value = v.trim()), 300)
})
const typeFilter = ref<string[]>([])
const exercisesFilter = ref<'' | 'yes' | 'no' | 'low'>('')
const appFilter = ref<'' | 'yes' | 'no'>('')

const filters = computed(() => {
  const f: Record<string, unknown> = { status: 'active' }
  if (typeFilter.value.length) f.types = typeFilter.value
  if (exercisesFilter.value) f.exercises = exercisesFilter.value
  if (appFilter.value) f.app = appFilter.value
  if (appliedQ.value) f.q = appliedQ.value
  return f
})
const clinicId = computed(() => store.currentClinicId ?? null)

interface Row {
  id: string
  first_name: string
  last_name: string | null
  active_count: number
  exercise_names: string[]
  schedule_name: string | null
  done_days: string[]
  has_app: boolean
  type_ids: string[]
  last_visit: string | null
}
const rows = ref<Row[]>([])
const total = ref(0)
const loading = ref(true)
const loadError = ref(false)
const stats = ref<{ patients: number; with_exercises: number; adherence_pct: number | null } | null>(null)

async function load() {
  loading.value = true
  const [{ data, count, error }, statsRes] = await Promise.all([
    supabase
      .rpc('patients_matching', { p_filters: filters.value as Json, p_clinic_id: clinicId.value ?? undefined }, { count: 'exact' })
      .select('id, first_name, last_name')
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('first_name')
      .range(page.value * PAGE, page.value * PAGE + PAGE - 1),
    supabase.rpc('patient_exercise_overview_stats', { p_filters: filters.value as Json, p_clinic_id: clinicId.value as string }),
  ])
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  loadError.value = false
  total.value = count ?? 0
  stats.value = (statsRes.data as typeof stats.value) ?? null
  const base = (data ?? []) as { id: string; first_name: string; last_name: string | null }[]
  const { data: detail } = base.length ? await supabase.rpc('patient_exercise_overview', { p_patient_ids: base.map((p) => p.id) }) : { data: [] }
  const byId = new Map(((detail ?? []) as (Omit<Row, 'id' | 'first_name' | 'last_name'> & { patient_id: string })[]).map((d) => [d.patient_id, d]))
  rows.value = base.map((p) => {
    const d = byId.get(p.id)
    return {
      ...p,
      active_count: d?.active_count ?? 0,
      exercise_names: d?.exercise_names ?? [],
      schedule_name: d?.schedule_name ?? null,
      done_days: d?.done_days ?? [],
      has_app: d?.has_app ?? false,
      type_ids: d?.type_ids ?? [],
      last_visit: d?.last_visit ?? null,
    }
  })
  loading.value = false
}
watch([filters, clinicId], () => {
  clearSelection()
  // Back to the first page reloads by itself (the watch below).
  if (page.value !== 0) page.value = 0
  else load()
}, { deep: true })
watch(page, load)
onMounted(load)

// --- the last seven days, oldest first ---
const week = computed(() => {
  const out: string[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
})
const pct = (r: Row) => Math.round((100 * r.done_days.length) / 7)

// --- selection ---
const selected = ref(new Set<string>())
const allMatching = ref(false)
const pageAll = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.id)))
function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  allMatching.value = false
}
function togglePage() {
  selected.value = pageAll.value ? new Set() : new Set(rows.value.map((r) => r.id))
  allMatching.value = false
}
function clearSelection() {
  selected.value = new Set()
  allMatching.value = false
}
const selectionCount = computed(() => (allMatching.value ? total.value : selected.value.size))
const selection = computed<PatientSelection>(() =>
  allMatching.value ? { filters: filters.value, clinicId: clinicId.value } : { patientIds: [...selected.value] },
)

// --- bulk actions ---
const dialog = ref<'' | 'assign' | 'type' | 'end'>('')
const busy = ref(false)
function done(summary: string) {
  dialog.value = ''
  showToast(summary)
  clearSelection()
  load()
  types.load()
}
async function endAll() {
  if (!store.accountId) return
  busy.value = true
  const who = selection.value
  const { data, error } = await supabase.rpc('end_exercises_for_patients', {
    p_account_id: store.accountId,
    p_patient_ids: ('patientIds' in who ? who.patientIds : null) as string[],
    p_filters: ('filters' in who ? who.filters : null) as Json,
    p_clinic_id: ('filters' in who ? who.clinicId : null) as string,
  })
  busy.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  done(t(`${data} exercises ended`, `${data} ejercicios finalizados`))
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)))
const chip = 'flex h-8 items-center gap-1.5 rounded-ctl border px-2.5 text-[12.5px] font-medium touch:h-10'
const formatDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) : '—')
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="exercises-overview" :data-ready="loading ? undefined : 'true'">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-card border border-line bg-surface px-4 py-3">
        <p class="font-mono text-[20px] font-semibold tabular-nums text-ink-900" data-cy="overview-stat-patients">{{ stats?.patients ?? '—' }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('patients', 'pacientes') }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface px-4 py-3">
        <p class="font-mono text-[20px] font-semibold tabular-nums text-ink-900" data-cy="overview-stat-with">{{ stats?.with_exercises ?? '—' }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('with exercises', 'con ejercicios') }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface px-4 py-3">
        <p class="font-mono text-[20px] font-semibold tabular-nums text-ink-900">{{ stats?.adherence_pct != null ? `${stats.adherence_pct}%` : '—' }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('days done, last 7', 'días hechos, últimos 7') }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface px-4 py-3">
        <p class="font-mono text-[20px] font-semibold tabular-nums text-ink-900" data-cy="overview-stat-without">{{ stats ? stats.patients - stats.with_exercises : '—' }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('without exercises', 'sin ejercicios') }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-2.5">
      <input
        v-model="q"
        type="search"
        :placeholder="t('Search patients', 'Buscar pacientes')"
        class="h-9 w-full max-w-[360px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
        data-cy="overview-search"
      />
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-faint">{{ t('Type', 'Tipo') }}</span>
        <button
          v-for="ty in types.active.value"
          :key="ty.id"
          type="button"
          :aria-pressed="typeFilter.includes(ty.id)"
          :class="[chip, typeFilter.includes(ty.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle']"
          data-cy="overview-type-filter"
          @click="typeFilter = typeFilter.includes(ty.id) ? typeFilter.filter((x) => x !== ty.id) : [...typeFilter, ty.id]"
        >
          <span class="h-2 w-2 rounded-full" :style="{ background: PATIENT_TYPE_DOT[ty.color] }" aria-hidden="true" />{{ ty.name }}
        </button>
        <NuxtLink v-if="types.active.value.length === 0 && !types.loading.value" to="/exercises?section=types" class="text-[12.5px] font-medium text-brand-text hover:underline">
          {{ t('No patient types yet', 'Aún no hay tipos de paciente') }}
        </NuxtLink>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-faint">{{ t('Exercises', 'Ejercicios') }}</span>
        <button
          v-for="o in [
            { v: '', l: t('Any', 'Todos') },
            { v: 'yes', l: t('With exercises', 'Con ejercicios') },
            { v: 'no', l: t('Without', 'Sin ejercicios') },
            { v: 'low', l: t('Not doing them', 'No los hace') },
          ] as const"
          :key="o.v"
          type="button"
          :aria-pressed="exercisesFilter === o.v"
          :class="[chip, exercisesFilter === o.v ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle']"
          :data-cy="`overview-exercises-${o.v || 'any'}`"
          @click="exercisesFilter = o.v"
        >
          {{ o.l }}
        </button>
        <span class="ml-3 mr-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-faint">{{ t('App', 'App') }}</span>
        <button
          v-for="o in [
            { v: '', l: t('Any', 'Todos') },
            { v: 'yes', l: t('Uses it', 'La usa') },
            { v: 'no', l: t('Does not', 'No la usa') },
          ] as const"
          :key="`app-${o.v}`"
          type="button"
          :aria-pressed="appFilter === o.v"
          :class="[chip, appFilter === o.v ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle']"
          @click="appFilter = o.v"
        >
          {{ o.l }}
        </button>
      </div>
    </div>

    <div v-if="selectionCount > 0" class="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-card border border-brand-tintBorder bg-brand-tint px-3 py-2 text-[13px]" data-cy="overview-bulk-bar">
      <span class="font-semibold text-brand-text" data-cy="overview-selection-count">{{ selectionCount === 1 ? t('1 selected', '1 seleccionado') : t(`${selectionCount} selected`, `${selectionCount} seleccionados`) }}</span>
      <button
        v-if="!allMatching && pageAll && total > rows.length"
        type="button"
        class="text-[12.5px] font-medium text-brand-text underline"
        data-cy="overview-select-all-matching"
        @click="allMatching = true"
      >
        {{ t(`Select all ${total} that match`, `Seleccionar los ${total} que cumplen el filtro`) }}
      </button>
      <span class="flex-1" />
      <UiBtn variant="primary" size="sm" data-cy="overview-bulk-assign" @click="dialog = 'assign'">{{ t('Assign exercises', 'Asignar ejercicios') }}</UiBtn>
      <UiBtn v-if="can('patients_edit')" size="sm" data-cy="overview-bulk-type" @click="dialog = 'type'">{{ t('Patient type', 'Tipo de paciente') }}</UiBtn>
      <UiBtn size="sm" data-cy="overview-bulk-end" @click="dialog = 'end'">{{ t('End exercises…', 'Finalizar ejercicios…') }}</UiBtn>
      <UiBtn variant="ghost" size="sm" @click="clearSelection">{{ t('Clear', 'Quitar selección') }}</UiBtn>
    </div>

    <div class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr class="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            <th class="w-10 py-2 pl-4"><input type="checkbox" class="h-4 w-4 accent-brand" :checked="pageAll" :aria-label="t('Select this page', 'Seleccionar esta página')" data-cy="overview-select-page" @change="togglePage" /></th>
            <th class="py-2 pr-3">{{ t('Patient', 'Paciente') }}</th>
            <th class="py-2 pr-3">{{ t('Type', 'Tipo') }}</th>
            <th class="py-2 pr-3">{{ t('Exercises', 'Ejercicios') }}</th>
            <th class="py-2 pr-3">{{ t('Last 7 days', 'Últimos 7 días') }}</th>
            <th class="py-2 pr-4">{{ t('Last visit', 'Última visita') }}</th>
          </tr>
        </thead>
        <tbody v-if="loading">
          <tr v-for="i in 5" :key="i" class="border-b border-line-divider"><td colspan="6" class="px-4 py-3"><UiSkeleton class="h-4 w-full rounded-ctlSm" /></td></tr>
        </tbody>
        <tbody v-else-if="loadError">
          <tr><td colspan="6" class="px-4 py-8 text-center text-ink-muted">{{ t("The patients couldn't be loaded.", 'No se han podido cargar los pacientes.') }} <button type="button" class="font-medium text-brand-text underline" @click="load">{{ t('Retry', 'Reintentar') }}</button></td></tr>
        </tbody>
        <tbody v-else-if="rows.length === 0">
          <tr><td colspan="6" class="px-4 py-8 text-center text-ink-muted">{{ t('No patient matches these filters.', 'Ningún paciente cumple estos filtros.') }}</td></tr>
        </tbody>
        <tbody v-else>
          <tr v-for="r in rows" :key="r.id" class="border-b border-line-divider last:border-b-0" data-cy="overview-row">
            <td class="py-2 pl-4"><input type="checkbox" class="h-4 w-4 accent-brand" :checked="allMatching || selected.has(r.id)" :aria-label="t(`Select ${r.first_name}`, `Seleccionar a ${r.first_name}`)" data-cy="overview-row-select" @change="toggle(r.id)" /></td>
            <td class="py-2 pr-3">
              <NuxtLink :to="`/patients/${r.id}?tab=clinical`" class="font-semibold text-ink-900 hover:text-brand-text" data-cy="overview-row-name">{{ r.first_name }} {{ r.last_name }}</NuxtLink>
              <span v-if="!r.has_app" class="ml-1.5 rounded-pill bg-chip-bg px-1.5 py-px text-[11px] text-chip-text">{{ t('no app', 'sin app') }}</span>
            </td>
            <td class="py-2 pr-3">
              <div class="flex flex-wrap gap-1">
                <template v-for="id in r.type_ids" :key="id">
                  <PatientsTypeChip v-if="types.byId.value.get(id)" :name="types.byId.value.get(id)!.name" :color="types.byId.value.get(id)!.color" />
                </template>
              </div>
            </td>
            <td class="max-w-[260px] py-2 pr-3" data-cy="overview-row-exercises">
              <span v-if="r.active_count === 0" class="text-ink-faint">{{ t('None', 'Sin ejercicios') }}</span>
              <span v-else class="block truncate text-ink-700">
                {{ r.exercise_names.join(', ') }}<span v-if="r.active_count > r.exercise_names.length" class="text-ink-muted"> +{{ r.active_count - r.exercise_names.length }}</span>
              </span>
              <span v-if="r.schedule_name" class="block truncate text-[11.5px] text-ink-muted">{{ t('Schedule', 'Pauta') }}: {{ r.schedule_name }}</span>
            </td>
            <td class="py-2 pr-3">
              <template v-if="r.active_count > 0">
                <span class="inline-flex gap-[3px] align-middle" :aria-label="t(`${r.done_days.length} of the last 7 days`, `${r.done_days.length} de los últimos 7 días`)">
                  <i v-for="d in week" :key="d" class="block h-2.5 w-2.5 rounded-[2px]" :class="r.done_days.includes(d) ? 'bg-success-accent' : 'bg-chip-border'" />
                </span>
                <span class="ml-1.5 font-mono text-[11.5px] tabular-nums" :class="r.done_days.length < 3 ? 'text-danger-text' : 'text-ink-muted'">{{ pct(r) }}%</span>
              </template>
              <span v-else class="text-ink-faint">—</span>
            </td>
            <td class="py-2 pr-4 text-ink-muted">{{ formatDay(r.last_visit) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="flex items-center justify-end gap-2 text-[13px] text-ink-muted">
      <UiBtn size="sm" :disabled="page === 0" @click="page--">{{ t('Previous', 'Anterior') }}</UiBtn>
      <span class="tabular-nums">{{ page + 1 }} / {{ totalPages }}</span>
      <UiBtn size="sm" :disabled="page + 1 >= totalPages" @click="page++">{{ t('Next', 'Siguiente') }}</UiBtn>
    </div>

    <ExercisesBulkAssignDialog v-if="dialog === 'assign'" :selection="selection" :count="selectionCount" @done="done" @cancel="dialog = ''" />
    <PatientsTypeAssignDialog v-if="dialog === 'type'" :selection="selection" :count="selectionCount" @done="done" @cancel="dialog = ''" />
    <UiConfirmDialog
      v-if="dialog === 'end'"
      :title="t(`End the exercises of ${selectionCount} patients?`, `¿Finalizar los ejercicios de ${selectionCount} pacientes?`)"
      :confirm-label="t('End exercises', 'Finalizar ejercicios')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      :busy="busy"
      @confirm="endAll"
      @cancel="dialog = ''"
    >
      <p class="text-[13px] text-ink-700">
        {{ t('Every exercise they have on stops showing in their app. Nothing is deleted: their ticked days stay in their history.', 'Todos los ejercicios que tienen dejan de verse en su app. No se borra nada: los días marcados siguen en su historial.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
