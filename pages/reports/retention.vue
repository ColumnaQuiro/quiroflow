<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { cohortRetention, rebookingByPractitioner, retentionPct, type RetentionVisit } from '~/utils/retentionStats'

// Retention: do patients come back, and do they finish what they started.
//
//   1. Care plans left unfinished: plans with visits to go and nothing booked,
//      overdue on their own cadence (care_plan_continuity_alerts, the view
//      behind "Plans behind schedule").
//   2. By the month of the first visit: how many came back for a second, and
//      how many were still coming three and six months later.
//   3. By practitioner: how many visits left with the next one booked, and
//      how many came back within 30 days.
//
// Every visit is read, not only the range's: "first visit" means the first
// ever, so a patient returning after a year is not counted as new. The
// arithmetic is utils/retentionStats.ts. What a practitioner who sees only
// their own patients may read is what RLS gives them, as in every report.
interface PlanAlert {
  patient_id: string
  default_practitioner_id: string | null
  first_name: string | null
  last_name: string | null
  care_plan_name: string | null
  total_visits: number
  completed_in_plan: number
  last_appointment_at: string | null
  days_overdue: number
}

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 12 }))
const { reportsPractitionerId } = useOwnScope()
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')

const loading = ref(true)
const visits = ref<RetentionVisit[]>([])
const plans = ref<PlanAlert[]>([])

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  const [all, alerts] = await Promise.all([
    fetchAllRows<RetentionVisit>((f, tt) => {
      let q = supabase.from('appointments').select('patient_id, practitioner_id, starts_at, ends_at, status, created_at').is('deleted_at', null).not('patient_id', 'is', null).order('starts_at')
      if (clinicFilter.value) q = q.eq('clinic_id', clinicFilter.value)
      return q.range(f, tt)
    }),
    supabase
      .from('care_plan_continuity_alerts')
      .select('patient_id, default_practitioner_id, first_name, last_name, care_plan_name, total_visits, completed_in_plan, last_appointment_at, days_overdue')
      .gt('days_overdue', 0)
      .order('days_overdue', { ascending: false })
      .limit(200),
  ])
  if (mine !== run) return
  visits.value = all
  plans.value = (alerts.data as PlanAlert[] | null) ?? []
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
watch(clinicFilter, load)

const bounds = computed(() => rangeBounds(range.value))
const now = new Date()
// The practitioner filter narrows the visits the figures are about; who
// came back is still read across every practitioner they saw since.
const ofPractitioner = (v: RetentionVisit) => !practitionerFilter.value || v.practitioner_id === practitionerFilter.value
const cohorts = computed(() => {
  // Cohorts are about who a practitioner saw first.
  const firstBy = new Map<string, string | null>()
  for (const v of visits.value) if (v.status === 'completed' && !firstBy.has(v.patient_id)) firstBy.set(v.patient_id, v.practitioner_id)
  const keep = practitionerFilter.value ? visits.value.filter((v) => firstBy.get(v.patient_id) === practitionerFilter.value) : visits.value
  return cohortRetention(keep, { from: bounds.value.from, to: bounds.value.to, now, timeZone: DEFAULT_CLINIC_TIMEZONE }).reverse()
})
const rebooking = computed(() => {
  const rows = rebookingByPractitioner(visits.value, { from: bounds.value.from, to: bounds.value.to, now })
  return practitionerFilter.value ? rows.filter((r) => r.practitionerId === practitionerFilter.value) : rows
})
const totals = computed(() => {
  const c = cohorts.value
  const sum = (f: (r: (typeof c)[number]) => number) => c.reduce((s, r) => s + f(r), 0)
  const r = rebooking.value
  return {
    newPatients: sum((x) => x.patients),
    cameBack: retentionPct(sum((x) => x.cameBack), sum((x) => x.patients)),
    at90: retentionPct(sum((x) => x.at90?.still ?? 0), sum((x) => x.at90?.of ?? 0)),
    rebooked: retentionPct(r.reduce((s, x) => s + x.rebooked, 0), r.reduce((s, x) => s + x.visits, 0)),
  }
})
// With a practitioner chosen, the plans of their patients.
const visiblePlans = computed(() => (practitionerFilter.value ? plans.value.filter((p) => p.default_practitioner_id === practitionerFilter.value) : plans.value))
const longGone = computed(() => visiblePlans.value.filter((p) => p.days_overdue > 30).length)

const show = (n: number | null) => (n === null ? '–' : `${n}%`)
const cell = (x: { of: number; still: number } | null) => (x ? show(retentionPct(x.still, x.of)) : '–')
const monthLabel = (m: string) => {
  const s = new Date(`${m}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const practitionerName = (id: string | null) => practitioners.value.find((p) => p.id === id)?.name ?? t('No practitioner', 'Sin profesional')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
const pdfRoot = ref<HTMLElement | null>(null)
const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2'
const td = 'px-3 py-2 font-mono text-[13px] text-ink-800'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Retention', 'Retención')" :meta="t('Who comes back, and who finishes their plan', 'Quién vuelve y quién termina su plan')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Retention', 'Retención')" :range="range" :practitioner-id="practitionerFilter || null" :clinic-id="clinicFilter || null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="retention" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="reportsPractitionerId" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ReportsStat :label="t('New patients', 'Pacientes nuevos')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-new">{{ totals.newPatients }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('first visit in the period', 'primera visita en el periodo') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Came back', 'Volvieron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-came-back">{{ show(totals.cameBack) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('had a second visit', 'tuvieron una segunda visita') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Still coming at 3 months', 'Siguen a los 3 meses')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-90">{{ show(totals.at90) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('a visit 90 days or more after the first', 'una visita 90 días o más tras la primera') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Left with the next one booked', 'Salieron con la siguiente reservada')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-rebooked">{{ show(totals.rebooked) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('of visits in the period', 'de las visitas del periodo') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule
        class="mt-4"
        :title="t('Care plans left unfinished', 'Planes sin terminar')"
        :description="t('Visits still to go, nothing booked, and past the date their cadence set. Whatever the period above.', 'Con visitas pendientes, nada reservado y pasada la fecha que marcaba su frecuencia. Sea cual sea el periodo de arriba.')"
        :loading="loading"
        skeleton="list"
        :rows="4"
      >
        <p v-if="visiblePlans.length" class="mt-2 text-[12.5px] text-ink-muted" data-cy="retention-plans-summary">
          {{ t(`${visiblePlans.length} plans overdue, ${longGone} of them by more than 30 days.`, `${visiblePlans.length} planes atrasados, ${longGone} de ellos más de 30 días.`) }}
        </p>
        <p v-else class="mt-2 text-[13px] text-ink-muted" data-cy="retention-plans-empty">{{ t('No plan is behind schedule.', 'Ningún plan va atrasado.') }}</p>
        <div v-if="visiblePlans.length" class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[560px]">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th :class="th">{{ t('Patient', 'Paciente') }}</th>
                <th :class="th">{{ t('Plan', 'Plan') }}</th>
                <th :class="th">{{ t('Done', 'Hechas') }}</th>
                <th :class="th">{{ t('Last visit', 'Última visita') }}</th>
                <th :class="th">{{ t('Overdue', 'Atraso') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="p in visiblePlans.slice(0, 50)" :key="p.patient_id" data-cy="retention-plan-row">
                <td class="px-3 py-2 text-[13px]"><NuxtLink :to="`/patients/${p.patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">{{ `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() }}</NuxtLink></td>
                <td class="px-3 py-2 text-[13px] text-ink-700">{{ p.care_plan_name }}</td>
                <td :class="td">{{ p.completed_in_plan }} / {{ p.total_visits }}</td>
                <td class="px-3 py-2 text-[13px] text-ink-muted">{{ when(p.last_appointment_at) }}</td>
                <td class="px-3 py-2 text-[13px]" :class="p.days_overdue > 30 ? 'font-semibold text-danger-text' : 'text-warning-text'">{{ t(`${p.days_overdue} days`, `${p.days_overdue} días`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportsModule :title="t('By month of first visit', 'Por mes de la primera visita')" :description="t('A month too recent to tell shows a dash.', 'Un mes demasiado reciente para saberlo muestra un guion.')" :loading="loading" skeleton="list" :rows="6">
          <p v-if="!cohorts.length" class="mt-2 text-[13px] text-ink-muted" data-cy="retention-cohorts-empty">{{ t('No first visits in this period.', 'No hay primeras visitas en este periodo.') }}</p>
          <div v-else class="mt-2 overflow-x-auto">
            <table class="w-full min-w-[420px]" data-cy="retention-cohorts">
              <thead class="border-b border-line bg-surface-subtle">
                <tr>
                  <th :class="th">{{ t('Month', 'Mes') }}</th>
                  <th :class="th">{{ t('New', 'Nuevos') }}</th>
                  <th :class="th">{{ t('Came back', 'Volvieron') }}</th>
                  <th :class="th">{{ t('3 months', '3 meses') }}</th>
                  <th :class="th">{{ t('6 months', '6 meses') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider">
                <tr v-for="c in cohorts" :key="c.month" data-cy="retention-cohort-row" :data-month="c.month">
                  <td class="px-3 py-2 text-[13px] text-ink-800">{{ monthLabel(c.month) }}</td>
                  <td :class="td">{{ c.patients }}</td>
                  <td :class="td" data-cy="retention-cohort-came-back">{{ show(retentionPct(c.cameBack, c.patients)) }}</td>
                  <td :class="td" data-cy="retention-cohort-90">{{ cell(c.at90) }}</td>
                  <td :class="td" data-cy="retention-cohort-180">{{ cell(c.at180) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ReportsModule>

        <ReportsModule :title="t('By practitioner', 'Por profesional')" :description="t('Booked again by the end of the visit day, and back within 30 days (visits at least 30 days old).', 'Reservada de nuevo antes de acabar el día de la visita, y vuelta en 30 días (visitas de hace al menos 30 días).')" :loading="loading" skeleton="list" :rows="4">
          <p v-if="!rebooking.length" class="mt-2 text-[13px] text-ink-muted">{{ t('No visits in this period.', 'No hay visitas en este periodo.') }}</p>
          <div v-else class="mt-2 overflow-x-auto">
            <table class="w-full min-w-[420px]" data-cy="retention-rebooking">
              <thead class="border-b border-line bg-surface-subtle">
                <tr>
                  <th :class="th">{{ t('Practitioner', 'Profesional') }}</th>
                  <th :class="th">{{ t('Visits', 'Visitas') }}</th>
                  <th :class="th">{{ t('Rebooked', 'Reservaron') }}</th>
                  <th :class="th">{{ t('Back in 30 days', 'Volvieron en 30 días') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider">
                <tr v-for="r in rebooking" :key="r.practitionerId ?? 'none'" data-cy="retention-rebooking-row">
                  <td class="px-3 py-2 text-[13px] text-ink-800">{{ practitionerName(r.practitionerId) }}</td>
                  <td :class="td">{{ r.visits }}</td>
                  <td :class="td" data-cy="retention-row-rebooked">{{ show(retentionPct(r.rebooked, r.visits)) }}</td>
                  <td :class="td">{{ show(retentionPct(r.cameBack30.came, r.cameBack30.of)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ReportsModule>
      </div>
    </div>
  </div>
</template>
