<script setup lang="ts">
// Retención, on the phone: the web's pages/reports/retention.vue, with the
// same reads and the same arithmetic (utils/retentionStats.ts), so a figure
// here is the figure there. Reshaped for a phone: the four tables become
// lists -- a month of first visits is one row with its three percentages
// side by side under it instead of a five-column grid, a practitioner's
// rebooking is one row -- and the unfinished plans list the first 50 with
// "Ver más" for the rest. Left out: the PDF button (no PDF on the app yet)
// and the pick-and-WhatsApp bulk send on the unfinished plans, whose modal
// (BulkSendWhatsAppModal) reads the web's account store; the app's own
// Planes con retraso (/plan-alerts) sends to each of those patients, and is
// linked from here for whoever may open it.
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { DEFAULT_CLINIC_TIMEZONE } from '../../../utils/clinicClock'
import { careStopCounts, cohortRetention, rebookingByPractitioner, retentionPct, winBackStats, type CareStopRow, type RetentionVisit, type WinBackContact } from '../../../utils/retentionStats'

definePageMeta({ layout: 'practitioner' })

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
//      within 30 days (winBackStats).
//   5. Why patients stopped: the reasons recorded in the period
//      (patient_care_stops, careStopCounts), by practitioner of the last
//      visit before they stopped.
//
// Every visit is read, not only the range's: "first visit" means the first
// ever, so a patient returning after a year is not counted as new. What a
// practitioner who sees only their own patients may read is what RLS gives
// them, as in every report.
interface PlanAlert {
  patient_id: string
  default_practitioner_id: string | null
  first_name: string | null
  last_name: string | null
  care_plan_name: string | null
  total_visits: number | null
  completed_in_plan: number
  last_appointment_at: string | null
  days_overdue: number
}

const PATH = '/reports/retention'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()
const { can } = usePractitionerContext()
const { shown } = usePrivacyMode()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()

const range = ref(computePresetRange({ months: 12 }))
const practitionerFilter = ref('')
const clinicFilter = ref('')

const loading = ref(true)
const failed = ref(false)
const visits = ref<RetentionVisit[]>([])
const plans = ref<PlanAlert[]>([])
const contacts = ref<WinBackContact[]>([])
// contact_log is behind recalls_access; a role without it reads nothing, and
// is shown nothing rather than "nobody contacted".
const seesContacts = ref(false)
const stops = ref<CareStopRow[]>([])
const { load: loadStopReasons, nameOf: stopReasonName } = useCareStopReasons()

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  try {
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
    if (alerts.error) throw alerts.error
    // A small table: every stop, narrowed below like the visits. As on the
    // web, a refused read is "no reasons recorded", not a failed report.
    const stopRows = await fetchAllRows<CareStopRow>((f, tt) => supabase.from('patient_care_stops').select('reason_id, practitioner_id, clinic_id, recorded_at').order('recorded_at').range(f, tt)).catch(() => [] as CareStopRow[])
    if (mine !== run) return
    stops.value = stopRows
    visits.value = all
    plans.value = (alerts.data as PlanAlert[] | null) ?? []
    contacts.value = contactRows.rows
    seesContacts.value = contactRows.ok && contactRows.rows.length > 0
  } catch (e) {
    console.error('[retention report]', e)
    if (mine === run) failed.value = true
  } finally {
    if (mine === run) loading.value = false
  }
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "nobody came back".
const ready = computed(() => !!context.value && canOpen(PATH))
watch(
  ready,
  (ok) => {
    if (!ok) return
    if (reportsPractitionerId.value) practitionerFilter.value = reportsPractitionerId.value
    load()
    loadFilterOptions()
    loadStopReasons()
  },
  { immediate: true },
)
watch(clinicFilter, () => { if (ready.value) load() })

const bounds = computed(() => rangeBounds(range.value))
const now = new Date()
const cohorts = computed(() => {
  // Cohorts are about who a practitioner saw first.
  const firstBy = new Map<string, string | null>()
  for (const v of visits.value) if (v.status === 'completed' && !firstBy.has(v.patient_id)) firstBy.set(v.patient_id, v.practitioner_id)
  const keep = practitionerFilter.value ? visits.value.filter((v) => firstBy.get(v.patient_id) === practitionerFilter.value) : visits.value
  return cohortRetention(keep, { from: bounds.value.from, to: bounds.value.to, now, timeZone: DEFAULT_CLINIC_TIMEZONE }).reverse()
})
// The practitioner filter narrows the visits the figures are about; who
// came back is still read across every practitioner they saw since.
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
const planLimit = ref(50)
watch(visiblePlans, () => { planLimit.value = 50 })
const shownPlans = computed(() => visiblePlans.value.slice(0, planLimit.value))

// Win-back over the period. Bookings are the visits already read: any
// appointment made after the contact counts, whoever it is with.
const winBack = computed(() => winBackStats(contacts.value, visits.value.map((v) => ({ patient_id: v.patient_id, created_at: v.created_at })), { from: bounds.value.from, to: bounds.value.to, now }))

const stopCounts = computed(() => careStopCounts(stops.value, { from: bounds.value.from, to: bounds.value.to, practitionerId: practitionerFilter.value || null, clinicId: clinicFilter.value || null }))
const stopSummary = (rows: { reasonId: string | null; count: number }[]) => rows.map((r) => `${stopReasonName(r.reasonId)} ${r.count}`).join(' · ')

const show = (n: number | null) => (n === null ? '–' : `${n}%`)
const cell = (x: { of: number; still: number } | null) => (x ? show(retentionPct(x.still, x.of)) : '–')
const monthLabel = (m: string) => {
  const s = new Date(`${m}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const practitionerName = (id: string | null) => practitioners.value.find((p) => p.id === id)?.name ?? t('No practitioner', 'Sin profesional')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
const planDone = (p: PlanAlert) => (p.total_visits === null ? t(`${p.completed_in_plan} · no end`, `${p.completed_in_plan} · sin fin`) : `${p.completed_in_plan} / ${p.total_visits}`)
const figureLabel = 'text-[11px] font-medium uppercase tracking-wide text-ink-muted'
const figureValue = 'font-mono text-[14px] font-semibold tabular-nums text-ink-900'
</script>

<template>
  <ReportScreen :title="t('Retention', 'Retención')" :path="PATH" :description="t('Who comes back, and who finishes their plan', 'Quién vuelve y quién termina su plan')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <div class="flex flex-col gap-3" data-cy="retention" :data-ready="loading ? undefined : 'true'">
      <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="retention-failed">
        {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ReportsStat :label="t('New patients', 'Pacientes nuevos')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-new">{{ totals.newPatients }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('first visit in the period', 'primera visita en el periodo') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Came back', 'Volvieron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-came-back">{{ show(totals.cameBack) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('had a second visit', 'tuvieron una segunda visita') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Still coming at 3 months', 'Siguen a los 3 meses')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-90">{{ show(totals.at90) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('a visit 90 days or more after the first', 'una visita 90 días o más tras la primera') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Left with the next one booked', 'Salieron con la siguiente reservada')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="retention-rebooked">{{ show(totals.rebooked) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('of visits in the period', 'de las visitas del periodo') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule
        v-if="seesContacts"
        :title="t('Win-back', 'Recuperación')"
        :description="t('Patients someone called or messaged in the period (Recalls, or a WhatsApp), and how many booked within 30 days of it.', 'Pacientes a los que alguien llamó o escribió en el periodo (Recalls, o un WhatsApp), y cuántos reservaron en los 30 días siguientes.')"
        :loading="loading"
        skeleton="list"
        :rows="1"
      >
        <p class="mt-2 text-[13.5px] text-ink-700" data-cy="retention-win-back">
          <span class="font-mono text-[18px] font-semibold text-ink-900">{{ winBack.booked }}</span>
          {{ t(`of ${winBack.contacted} contacted booked`, `de ${winBack.contacted} contactados reservaron`) }}
          <template v-if="winBack.contacted"> ({{ show(retentionPct(winBack.booked, winBack.contacted)) }})</template>
          <span v-if="winBack.waiting" class="block text-[12.5px] text-ink-muted">{{ t(`${winBack.waiting} contacted under 30 days ago, still to tell`, `${winBack.waiting} contactados hace menos de 30 días, aún por ver`) }}</span>
        </p>
      </ReportsModule>

      <ReportsModule
        :title="t('Why patients stopped', 'Por qué dejaron de venir')"
        :description="t('Reasons recorded in the period, from Recalls or the patient\'s record. Counted for the practitioner and clinic of their last visit.', 'Motivos registrados en el periodo, desde Recordatorios o la ficha. Contados para el profesional y la clínica de su última visita.')"
        :loading="loading"
        skeleton="list"
        :rows="3"
      >
        <p v-if="!stopCounts.total" class="py-3 text-[13.5px] text-ink-faint" data-cy="retention-stops-empty">{{ t('No reasons recorded in this period.', 'No hay motivos registrados en este periodo.') }}</p>
        <template v-else>
          <ul class="mt-1" data-cy="retention-stops">
            <ReportRow
              v-for="r in stopCounts.byReason"
              :key="r.reasonId ?? 'none'"
              :title="stopReasonName(r.reasonId)"
              :value="String(r.count)"
              :value-note="show(retentionPct(r.count, stopCounts.total))"
              data-cy="retention-stop-row"
            />
          </ul>
          <template v-if="!practitionerFilter && stopCounts.byPractitioner.length > 1">
            <p class="mt-3 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('By practitioner', 'Por profesional') }}</p>
            <ul data-cy="retention-stops-by-practitioner">
              <ReportRow
                v-for="p in stopCounts.byPractitioner"
                :key="p.practitionerId ?? 'none'"
                :title="practitionerName(p.practitionerId)"
                :subtitle="stopSummary(p.byReason)"
                :value="String(p.total)"
                :value-note="t('stopped', 'bajas')"
              />
            </ul>
          </template>
        </template>
      </ReportsModule>

      <ReportsModule
        :title="t('Care plans left unfinished', 'Planes sin terminar')"
        :description="t('Visits still to go, nothing booked, and past the date their cadence set. Whatever the period above.', 'Con visitas pendientes, nada reservado y pasada la fecha que marcaba su frecuencia. Sea cual sea el periodo de arriba.')"
        :loading="loading"
        skeleton="list"
        :rows="4"
      >
        <p v-if="visiblePlans.length" class="mt-2 text-[12.5px] text-ink-muted" data-cy="retention-plans-summary">
          {{ t(`${visiblePlans.length} plans overdue, ${longGone} of them by more than 30 days.`, `${visiblePlans.length} planes atrasados, ${longGone} de ellos más de 30 días.`) }}
          <NuxtLink v-if="can('recalls_access')" to="/plan-alerts" class="inline-flex min-h-[44px] items-center font-semibold text-brand-text" data-cy="retention-plans-alerts">{{ t('Message them in Plans behind schedule', 'Escríbeles desde Planes con retraso') }}</NuxtLink>
        </p>
        <p v-else class="py-3 text-[13.5px] text-ink-faint" data-cy="retention-plans-empty">{{ t('No plan is behind schedule.', 'Ningún plan va atrasado.') }}</p>
        <ul v-if="visiblePlans.length" class="mt-1" data-cy="retention-plans">
          <ReportRow
            v-for="p in shownPlans"
            :key="p.patient_id"
            :to="`/patients/${p.patient_id}`"
            :title="shown(`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—')"
            :subtitle="`${p.care_plan_name ?? ''} · ${t('done', 'hechas')} ${planDone(p)} · ${t('last visit', 'última visita')} ${when(p.last_appointment_at)}`"
            :value="t(`${p.days_overdue} days`, `${p.days_overdue} días`)"
            :value-note="t('overdue', 'de atraso')"
            :tone="p.days_overdue > 30 ? 'danger' : 'warning'"
            data-cy="retention-plan-row"
          />
        </ul>
        <button v-if="visiblePlans.length > planLimit" type="button" class="mt-1 h-11 w-full rounded-ctl border border-line-control text-[13.5px] font-semibold text-ink-700" data-cy="retention-plans-more" @click="planLimit += 50">
          {{ t(`Show more (${visiblePlans.length - planLimit})`, `Ver más (${visiblePlans.length - planLimit})`) }}
        </button>
      </ReportsModule>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <!-- The web's five-column grid (month, new, came back, 3 and 6 months)
             as one row per month: the month and how many were new, with the
             three percentages side by side beneath it. -->
        <ReportsModule :title="t('By month of first visit', 'Por mes de la primera visita')" :description="t('A month too recent to tell shows a dash.', 'Un mes demasiado reciente para saberlo muestra un guion.')" :loading="loading" skeleton="list" :rows="6">
          <p v-if="!cohorts.length" class="py-3 text-[13.5px] text-ink-faint" data-cy="retention-cohorts-empty">{{ t('No first visits in this period.', 'No hay primeras visitas en este periodo.') }}</p>
          <ul v-else class="mt-1" data-cy="retention-cohorts">
            <li v-for="c in cohorts" :key="c.month" class="border-b border-line-divider py-2.5 last:border-b-0" data-cy="retention-cohort-row" :data-month="c.month">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-[14.5px] font-medium text-ink-900">{{ monthLabel(c.month) }}</span>
                <span class="text-[12.5px] text-ink-muted"><span class="font-mono font-semibold text-ink-900">{{ c.patients }}</span> {{ t('new', 'nuevos') }}</span>
              </div>
              <dl class="mt-1.5 grid grid-cols-3 gap-2">
                <div>
                  <dt :class="figureLabel">{{ t('Came back', 'Volvieron') }}</dt>
                  <dd :class="figureValue" data-cy="retention-cohort-came-back">{{ show(retentionPct(c.cameBack, c.patients)) }}</dd>
                </div>
                <div>
                  <dt :class="figureLabel">{{ t('3 months', '3 meses') }}</dt>
                  <dd :class="figureValue" data-cy="retention-cohort-90">{{ cell(c.at90) }}</dd>
                </div>
                <div>
                  <dt :class="figureLabel">{{ t('6 months', '6 meses') }}</dt>
                  <dd :class="figureValue" data-cy="retention-cohort-180">{{ cell(c.at180) }}</dd>
                </div>
              </dl>
            </li>
          </ul>
        </ReportsModule>

        <ReportsModule :title="t('By practitioner', 'Por profesional')" :description="t('Booked again by the end of the visit day, and back within 30 days (visits at least 30 days old).', 'Reservada de nuevo antes de acabar el día de la visita, y vuelta en 30 días (visitas de hace al menos 30 días).')" :loading="loading" skeleton="list" :rows="4">
          <p v-if="!rebooking.length" class="py-3 text-[13.5px] text-ink-faint">{{ t('No visits in this period.', 'No hay visitas en este periodo.') }}</p>
          <ul v-else class="mt-1" data-cy="retention-rebooking">
            <ReportRow
              v-for="r in rebooking"
              :key="r.practitionerId ?? 'none'"
              :title="practitionerName(r.practitionerId)"
              :subtitle="t(`${r.visits} visits · back in 30 days ${show(retentionPct(r.cameBack30.came, r.cameBack30.of))}`, `${r.visits} visitas · volvieron en 30 días ${show(retentionPct(r.cameBack30.came, r.cameBack30.of))}`)"
              :value="show(retentionPct(r.rebooked, r.visits))"
              :value-note="t('rebooked', 'reservaron')"
              data-cy="retention-rebooking-row"
            />
          </ul>
        </ReportsModule>
      </div>
    </div>
  </ReportScreen>
</template>
