<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { careStopCounts, cohortRetention, rebookingByPractitioner, retentionPct, winBackStats, type CareStopRow, type RetentionVisit, type WinBackContact } from '~/utils/retentionStats'

// Retention: do patients come back, and do they finish what they started.
//
//   1. Care plans left unfinished: plans with visits to go and nothing booked,
//      overdue on their own cadence (care_plan_continuity_alerts, the view
//      behind "Plans behind schedule").
//   2. By the month of the first visit: how many came back for a second, and
//      how many were still coming three and six months later.
//   3. By practitioner: how many visits left with the next one booked, and
//      how many came back within 30 days.
//   4. Win-back: of the patients someone reached out to, how many booked
//      within 30 days (winBackStats) -- and, from the unfinished plans, a
//      WhatsApp to the ones picked, the same bulk send Recalls has.
//   5. Why patients stopped: the reasons recorded in the period
//      (patient_care_stops, careStopCounts), by practitioner of the last
//      visit before they stopped.
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
const contacts = ref<WinBackContact[]>([])
// contact_log is behind recalls_access; a role without it reads nothing, and
// is shown nothing rather than "nobody contacted".
const seesContacts = ref(false)
const store = useAccountStore()
const stops = ref<CareStopRow[]>([])
const { load: loadStopReasons, nameOf: stopReasonName } = useCareStopReasons()

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  const [all, alerts, contactRows] = await Promise.all([
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
    // Reaching out, not appointment reminders: those carry the appointment.
    fetchAllRows<WinBackContact>((f, tt) => supabase.from('contact_log').select('patient_id, created_at').is('appointment_id', null).order('created_at').range(f, tt)).then(
      (rows) => ({ rows, ok: true }),
      () => ({ rows: [] as WinBackContact[], ok: false }),
    ),
  ])
  // A small table: every stop, narrowed below like the visits.
  const stopRows = await fetchAllRows<CareStopRow>((f, tt) => supabase.from('patient_care_stops').select('reason_id, practitioner_id, clinic_id, recorded_at').order('recorded_at').range(f, tt)).catch(() => [] as CareStopRow[])
  if (mine !== run) return
  stops.value = stopRows
  visits.value = all
  plans.value = (alerts.data as PlanAlert[] | null) ?? []
  contacts.value = contactRows.rows
  seesContacts.value = contactRows.ok && contactRows.rows.length > 0
  loadPhones()
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
  loadStopReasons()
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

// Win-back over the period. Bookings are the visits already read: any
// appointment made after the contact counts, whoever it is with.
const winBack = computed(() => winBackStats(contacts.value, visits.value.map((v) => ({ patient_id: v.patient_id, created_at: v.created_at })), { from: bounds.value.from, to: bounds.value.to, now }))

const stopCounts = computed(() => careStopCounts(stops.value, { from: bounds.value.from, to: bounds.value.to, practitionerId: practitionerFilter.value || null, clinicId: clinicFilter.value || null }))
const stopSummary = (rows: { reasonId: string | null; count: number }[]) => rows.map((r) => `${stopReasonName(r.reasonId)} ${r.count}`).join(' · ')

// Picking unfinished plans to message. Nobody without a phone is sent a
// WhatsApp; the bar says how many are skipped, as on Recalls.
const shownPlans = computed(() => visiblePlans.value.slice(0, 50))
const picked = ref<Set<string>>(new Set())
const phones = ref<Set<string>>(new Set())
async function loadPhones() {
  const ids = plans.value.map((p) => p.patient_id)
  if (!ids.length) return
  const { data } = await supabase.from('patient_contact_numbers').select('patient_id').in('patient_id', ids)
  phones.value = new Set(((data ?? []) as { patient_id: string }[]).map((r) => r.patient_id))
}
const allPicked = computed(() => shownPlans.value.length > 0 && shownPlans.value.every((p) => picked.value.has(p.patient_id)))
function togglePick(id: string) {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}
function toggleAll() {
  picked.value = allPicked.value ? new Set() : new Set(shownPlans.value.map((p) => p.patient_id))
}
const pickedPlans = computed(() => shownPlans.value.filter((p) => picked.value.has(p.patient_id)))
const reachable = computed(() => pickedPlans.value.filter((p) => phones.value.has(p.patient_id)))
const bulkOpen = ref(false)
function onBulkClosed() {
  bulkOpen.value = false
  picked.value = new Set()
  load()
}

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
        v-if="seesContacts"
        class="mt-4"
        :title="t('Win-back', 'Recuperación')"
        :description="t('Patients someone called or messaged in the period (Recalls, or the WhatsApp below), and how many booked within 30 days of it.', 'Pacientes a los que alguien llamó o escribió en el periodo (Recalls, o el WhatsApp de abajo), y cuántos reservaron en los 30 días siguientes.')"
        :loading="loading"
        skeleton="list"
        :rows="1"
      >
        <p class="mt-2 text-[13.5px] text-ink-700" data-cy="retention-win-back">
          <span class="font-mono text-[18px] font-semibold text-ink-900">{{ winBack.booked }}</span>
          {{ t(`of ${winBack.contacted} contacted booked`, `de ${winBack.contacted} contactados reservaron`) }}
          <template v-if="winBack.contacted"> ({{ show(retentionPct(winBack.booked, winBack.contacted)) }})</template>
          <span v-if="winBack.waiting" class="text-ink-muted"> &middot; {{ t(`${winBack.waiting} contacted under 30 days ago, still to tell`, `${winBack.waiting} contactados hace menos de 30 días, aún por ver`) }}</span>
        </p>
      </ReportsModule>

      <ReportsModule
        class="mt-4"
        :title="t('Why patients stopped', 'Por qué dejaron de venir')"
        :description="t('Reasons recorded in the period, from Recalls or the patient\'s record (Settings › Recalls). Counted for the practitioner and clinic of their last visit.', 'Motivos registrados en el periodo, desde Recordatorios o la ficha (Ajustes › Recordatorios). Contados para el profesional y la clínica de su última visita.')"
        :loading="loading"
        skeleton="list"
        :rows="3"
      >
        <p v-if="!stopCounts.total" class="mt-2 text-[13px] text-ink-muted" data-cy="retention-stops-empty">{{ t('No reasons recorded in this period.', 'No hay motivos registrados en este periodo.') }}</p>
        <div v-else class="mt-2 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[320px]" data-cy="retention-stops">
              <thead class="border-b border-line bg-surface-subtle">
                <tr>
                  <th :class="th">{{ t('Reason', 'Motivo') }}</th>
                  <th :class="th">{{ t('Patients', 'Pacientes') }}</th>
                  <th :class="th">{{ t('Share', 'Peso') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider">
                <tr v-for="r in stopCounts.byReason" :key="r.reasonId ?? 'none'" data-cy="retention-stop-row">
                  <td class="px-3 py-2 text-[13px] text-ink-800" data-cy="retention-stop-reason">{{ stopReasonName(r.reasonId) }}</td>
                  <td :class="td" data-cy="retention-stop-count">{{ r.count }}</td>
                  <td :class="td">{{ show(retentionPct(r.count, stopCounts.total)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!practitionerFilter && stopCounts.byPractitioner.length > 1" class="overflow-x-auto">
            <table class="w-full min-w-[320px]" data-cy="retention-stops-by-practitioner">
              <thead class="border-b border-line bg-surface-subtle">
                <tr>
                  <th :class="th">{{ t('Practitioner', 'Profesional') }}</th>
                  <th :class="th">{{ t('Stopped', 'Bajas') }}</th>
                  <th :class="th">{{ t('Reasons', 'Motivos') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider">
                <tr v-for="p in stopCounts.byPractitioner" :key="p.practitionerId ?? 'none'">
                  <td class="px-3 py-2 text-[13px] text-ink-800">{{ practitionerName(p.practitionerId) }}</td>
                  <td :class="td">{{ p.total }}</td>
                  <td class="px-3 py-2 text-[12.5px] text-ink-muted">{{ stopSummary(p.byReason) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </ReportsModule>

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
        <div v-if="picked.size > 0" class="mt-2 flex flex-wrap items-center gap-2 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2" data-pdf-skip data-cy="retention-plans-bulk">
          <strong class="text-[13.5px] text-brand-text">{{ t(`${picked.size} selected`, `${picked.size} seleccionados`) }}</strong>
          <button type="button" class="h-9 rounded-ctl bg-brand px-3 text-[13px] font-bold text-surface disabled:opacity-50 touch:h-11" :disabled="reachable.length === 0" data-cy="retention-plans-whatsapp" @click="bulkOpen = true">
            {{ t(`WhatsApp ${reachable.length}`, `WhatsApp a ${reachable.length}`) }}
          </button>
          <span v-if="pickedPlans.length > reachable.length" class="text-[12.5px] text-ink-500">{{ t(`${pickedPlans.length - reachable.length} without a phone, skipped`, `${pickedPlans.length - reachable.length} sin teléfono, se salta`) }}</span>
          <button type="button" class="ml-auto h-9 px-2 text-[13px] text-ink-muted" @click="picked = new Set()">{{ t('Clear', 'Quitar')}}</button>
        </div>
        <div v-if="visiblePlans.length" class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[560px]">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th class="w-8 px-3 py-2" data-pdf-skip><input type="checkbox" class="h-4 w-4 accent-brand" :checked="allPicked" :aria-label="t('Select all', 'Seleccionar todos')" data-cy="retention-plans-all" @change="toggleAll" /></th>
                <th :class="th">{{ t('Patient', 'Paciente') }}</th>
                <th :class="th">{{ t('Plan', 'Plan') }}</th>
                <th :class="th">{{ t('Done', 'Hechas') }}</th>
                <th :class="th">{{ t('Last visit', 'Última visita') }}</th>
                <th :class="th">{{ t('Overdue', 'Atraso') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="p in shownPlans" :key="p.patient_id" data-cy="retention-plan-row">
                <td class="px-3 py-2" data-pdf-skip><input type="checkbox" class="h-4 w-4 accent-brand" :checked="picked.has(p.patient_id)" :aria-label="t('Select', 'Seleccionar')" data-cy="retention-plan-pick" @change="togglePick(p.patient_id)" /></td>
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

    <BulkSendWhatsAppModal
      v-if="bulkOpen"
      :targets="reachable.map((p) => ({ patientId: p.patient_id, firstName: p.first_name ?? '' }))"
      :default-template-name="store.whatsappRecallTemplateName"
      @close="onBulkClosed"
    />
  </div>
</template>
