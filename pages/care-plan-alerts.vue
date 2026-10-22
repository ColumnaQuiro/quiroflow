<script setup lang="ts">
import { visitMarkerLabel } from '~/utils/carePlanVisitMarkers'

// Plan-aware counterpart to pages/recalls.vue -- same "who's overdue, let me
// message them" shape, but scoped to patients actively on a care plan
// (care_plan_continuity_alerts) rather than a flat days-since-last-visit
// threshold. Deliberately reuses SendWhatsAppModal.vue rather than
// duplicating recalls.vue's messaging UI.
//
// Then the plans' re-exam visits booked ahead as some other appointment type
// than the plan asks for (care_plan_marked_visits): the review that a
// reschedule pushed onto an ordinary slot, with the fix one click away.
//
// Below it, the patients who have stopped doing their home exercises
// (exercise_adherence_alerts): the same kind of "someone is falling off
// their treatment", and the same action.
interface AlertRow {
  patient_id: string
  first_name: string
  last_name: string | null
  email: string | null
  preferred_language: string | null
  care_plan_name: string | null
  frequency_value: number
  frequency_unit: 'week' | 'month'
  visits_per_period: number | null
  total_visits: number
  visits_remaining: number
  last_appointment_at: string
  due_date: string
  days_overdue: number
  default_practitioner_id: string | null
}

interface ExerciseAlertRow {
  patient_id: string
  first_name: string
  last_name: string | null
  preferred_language: string | null
  active_exercises: number
  last_done_on: string | null
  days_without: number
}

interface MarkerMismatchRow {
  appointment_id: string
  patient_id: string
  starts_at: string
  visit_number: number
  label: string
  expected_appointment_type_id: string
  expected_type_name: string
  booked_type_name: string | null
  patient_name: string
}

const supabase = useSupabaseClient()
const t = useT()

const rows = ref<AlertRow[]>([])
const exerciseRows = ref<ExerciseAlertRow[]>([])
const markerRows = ref<MarkerMismatchRow[]>([])
const markerError = ref('')
const fixing = ref<string | null>(null)
const loading = ref(true)
const messagingPatientId = ref<string | null>(null)

// Silent after a message goes out: the list is already on screen, and
// swapping it for skeleton rows to drop one patient was a jump for nothing.
async function load(opts: { silent?: boolean } = {}) {
  if (!opts.silent) loading.value = true
  const [{ data }, { data: exercises }] = await Promise.all([
    supabase.from('care_plan_continuity_alerts').select('*').order('days_overdue', { ascending: false }),
    supabase
      .from('exercise_adherence_alerts')
      .select('patient_id, first_name, last_name, preferred_language, active_exercises, last_done_on, days_without')
      .order('days_without', { ascending: false }),
  ])
  rows.value = (data as AlertRow[]) ?? []
  exerciseRows.value = (exercises as ExerciseAlertRow[] | null) ?? []
  await loadMarkerMismatches()
  loading.value = false
}

// From the start of today: a re-exam already seen as the wrong type is
// history, and nothing here can change it.
async function loadMarkerMismatches() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { data } = await supabase.rpc('care_plan_marked_visits', { p_from: today.toISOString() })
  const wrong = (data ?? []).filter((m) => m.mismatch && m.status === 'booked' && m.expected_appointment_type_id)
  if (wrong.length === 0) {
    markerRows.value = []
    return
  }
  const typeIds = [...new Set(wrong.map((m) => m.appointment_type_id).filter((id): id is string => !!id))]
  const [{ data: patients }, { data: types }] = await Promise.all([
    supabase.from('patients').select('id, first_name, last_name').in('id', [...new Set(wrong.map((m) => m.patient_id))]),
    typeIds.length ? supabase.from('appointment_types').select('id, name').in('id', typeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const nameOf = new Map((patients ?? []).map((p) => [p.id, patientName(p)]))
  const typeOf = new Map((types ?? []).map((ty) => [ty.id, ty.name]))
  markerRows.value = wrong
    .map((m) => ({
      appointment_id: m.appointment_id,
      patient_id: m.patient_id,
      starts_at: m.starts_at,
      visit_number: m.visit_number,
      label: visitMarkerLabel(m, t),
      expected_appointment_type_id: m.expected_appointment_type_id!,
      expected_type_name: m.expected_type_name ?? '',
      booked_type_name: m.appointment_type_id ? (typeOf.get(m.appointment_type_id) ?? null) : null,
      patient_name: nameOf.get(m.patient_id) ?? '',
    }))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

async function fixMarker(row: MarkerMismatchRow) {
  markerError.value = ''
  fixing.value = row.appointment_id
  const { error } = await supabase.from('appointments').update({ appointment_type_id: row.expected_appointment_type_id }).eq('id', row.appointment_id)
  fixing.value = null
  if (error) {
    markerError.value = t("Couldn't change the type. Open the visit in the calendar.", 'No se ha podido cambiar el tipo. Abre la cita en el calendario.')
    return
  }
  await loadMarkerMismatches()
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
onMounted(() => load())

function patientName(row: { first_name: string; last_name: string | null }) {
  return `${row.first_name} ${row.last_name ?? ''}`.trim()
}
function cadenceLabel(row: AlertRow) {
  return carePlanCadenceLabel(row, t)
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
function openMessage(row: { patient_id: string }) {
  messagingPatientId.value = row.patient_id
}
function onSent() {
  messagingPatientId.value = null
  load({ silent: true })
}
const messagingRow = computed(() => [...rows.value, ...exerciseRows.value].find((r) => r.patient_id === messagingPatientId.value) ?? null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Care Plan Alerts', 'Alertas de plan de cuidados')" :meta="loading ? undefined : `${rows.length} ${t('behind schedule', 'con retraso')}`" />

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <p class="mb-4 text-[13px] text-ink-muted2">
        {{
          t(
            "Patients on an active care plan whose next visit is overdue by the plan's own cadence, with no future appointment booked.",
            'Pacientes con un plan de cuidados activo cuya próxima visita está retrasada según la cadencia del propio plan, sin ninguna cita futura reservada.',
          )
        }}
      </p>

      <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table class="w-full text-[13px]" :class="rows.length ? 'min-w-[640px]' : ''">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Plan', 'Plan') }}</th>
              <th class="px-3 py-2">{{ t('Progress', 'Progreso') }}</th>
              <th class="px-3 py-2">{{ t('Last visit', 'Última visita') }}</th>
              <th class="px-3 py-2">{{ t('Due', 'Vencía') }}</th>
              <th class="px-3 py-2">{{ t('Overdue by', 'Retraso') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-if="loading">
              <tr v-for="i in 4" :key="i">
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-28 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-24 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-20 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5" />
              </tr>
            </template>
            <tr v-else-if="rows.length === 0">
              <td colspan="7" class="px-3 py-6 text-center text-ink-faint">{{ t('No care plans behind schedule.', 'Ningún plan de cuidados retrasado.') }}</td>
            </tr>
            <tr v-for="row in rows" :key="row.patient_id">
              <td class="px-3 py-2">
                <NuxtLink :to="`/patients/${row.patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">{{ patientName(row) }}</NuxtLink>
              </td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.care_plan_name }} · {{ cadenceLabel(row) }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.total_visits - row.visits_remaining }} / {{ row.total_visits }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatDate(row.last_appointment_at) }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatDate(row.due_date) }}</td>
              <td class="px-3 py-2">
                <UiPill tone="danger">{{ row.days_overdue }} {{ t('days', 'días') }}</UiPill>
              </td>
              <td class="px-3 py-2 text-right">
                <button type="button" class="text-[12px] font-medium text-brand-text hover:underline" @click="openMessage(row)">
                  {{ t('Message', 'Mensaje') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="mb-1 mt-8 text-[15px] font-semibold text-ink-900">{{ t('Re-exams booked as the wrong type', 'Revisiones reservadas con otro tipo') }}</h2>
      <p class="mb-4 text-[13px] text-ink-muted2">
        {{
          t(
            "Upcoming visits that the patient's care plan marks as a re-exam with its own appointment type, booked as another type -- usually after a reschedule moved the visits around.",
            'Próximas visitas que el plan del paciente marca como revisión con su propio tipo de cita, reservadas con otro tipo: normalmente porque al reprogramar se han movido las visitas.',
          )
        }}
      </p>
      <p v-if="markerError" class="mb-3 rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text">{{ markerError }}</p>
      <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card" data-cy="marker-mismatches">
        <table class="w-full text-[13px]" :class="markerRows.length ? 'min-w-[640px]' : ''">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('When', 'Cuándo') }}</th>
              <th class="px-3 py-2">{{ t('Visit', 'Visita') }}</th>
              <th class="px-3 py-2">{{ t('Booked as', 'Reservada como') }}</th>
              <th class="px-3 py-2">{{ t('Plan says', 'El plan dice') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="loading">
              <td colspan="6" class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-40 rounded-ctlSm" /></td>
            </tr>
            <tr v-else-if="markerRows.length === 0">
              <td colspan="6" class="px-3 py-6 text-center text-ink-faint">{{ t('Every upcoming re-exam is booked as its plan says.', 'Todas las próximas revisiones están reservadas como dice su plan.') }}</td>
            </tr>
            <tr v-for="row in loading ? [] : markerRows" :key="row.appointment_id" data-cy="marker-mismatch-row">
              <td class="px-3 py-2">
                <NuxtLink :to="`/patients/${row.patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">{{ row.patient_name }}</NuxtLink>
              </td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatDateTime(row.starts_at) }}</td>
              <td class="px-3 py-2 text-ink-muted2">
                <span class="inline-flex items-center gap-1"><CalendarVisitMarkerIcon class="text-brand-text" />{{ row.visit_number }} · {{ row.label }}</span>
              </td>
              <td class="px-3 py-2"><UiPill tone="warning">{{ row.booked_type_name ?? t('No type', 'Sin tipo') }}</UiPill></td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.expected_type_name }}</td>
              <td class="px-3 py-2 text-right">
                <button type="button" :disabled="fixing === row.appointment_id" class="text-[12px] font-medium text-brand-text hover:underline disabled:opacity-50" data-cy="marker-mismatch-fix" @click="fixMarker(row)">
                  {{ t(`Change to ${row.expected_type_name}`, `Cambiar a ${row.expected_type_name}`) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="mb-1 mt-8 text-[15px] font-semibold text-ink-900">{{ t('Home exercises not being done', 'Ejercicios en casa sin hacer') }}</h2>
      <p class="mb-4 text-[13px] text-ink-muted2">
        {{ t('Patients with the app and home exercises who have not ticked any for 5 days or more.', 'Pacientes con la app y ejercicios en casa que llevan 5 días o más sin marcar ninguno.') }}
      </p>
      <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card" data-cy="exercise-alerts">
        <table class="w-full text-[13px]" :class="exerciseRows.length ? 'min-w-[560px]' : ''">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Exercises', 'Ejercicios') }}</th>
              <th class="px-3 py-2">{{ t('Last ticked', 'Último marcado') }}</th>
              <th class="px-3 py-2">{{ t('Without', 'Sin hacer') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="loading">
              <td colspan="5" class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-40 rounded-ctlSm" /></td>
            </tr>
            <tr v-else-if="exerciseRows.length === 0">
              <td colspan="5" class="px-3 py-6 text-center text-ink-faint">{{ t('Everyone with exercises is keeping up.', 'Todos los que tienen ejercicios los están haciendo.') }}</td>
            </tr>
            <tr v-for="row in loading ? [] : exerciseRows" :key="row.patient_id" data-cy="exercise-alert-row">
              <td class="px-3 py-2">
                <NuxtLink :to="`/patients/${row.patient_id}?tab=clinical`" class="font-medium text-ink-900 hover:text-brand-text">{{ patientName(row) }}</NuxtLink>
              </td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.active_exercises }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.last_done_on ? formatDate(`${row.last_done_on}T12:00:00Z`) : t('Never', 'Nunca') }}</td>
              <td class="px-3 py-2">
                <UiPill tone="warning">{{ row.days_without }} {{ t('days', 'días') }}</UiPill>
              </td>
              <td class="px-3 py-2 text-right">
                <button type="button" class="text-[12px] font-medium text-brand-text hover:underline" data-cy="exercise-alert-message" @click="openMessage(row)">
                  {{ t('Message', 'Mensaje') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="messagingRow"
      :patient-id="messagingRow.patient_id"
      :patient-first-name="messagingRow.first_name"
      :patient-preferred-language="messagingRow.preferred_language ?? undefined"
      @close="messagingPatientId = null"
      @sent="onSent"
    />
  </div>
</template>
