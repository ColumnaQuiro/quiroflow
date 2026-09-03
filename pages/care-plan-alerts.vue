<script setup lang="ts">
// Plan-aware counterpart to pages/recalls.vue -- same "who's overdue, let me
// message them" shape, but scoped to patients actively on a care plan
// (care_plan_continuity_alerts) rather than a flat days-since-last-visit
// threshold. Deliberately reuses SendWhatsAppModal.vue rather than
// duplicating recalls.vue's messaging UI.
interface AlertRow {
  patient_id: string
  first_name: string
  last_name: string | null
  email: string | null
  preferred_language: string | null
  care_plan_name: string | null
  frequency_value: number
  frequency_unit: 'week' | 'month'
  total_visits: number
  visits_remaining: number
  last_appointment_at: string
  due_date: string
  days_overdue: number
  default_practitioner_id: string | null
}

const supabase = useSupabaseClient()
const t = useT()

const rows = ref<AlertRow[]>([])
const loading = ref(true)
const messagingPatientId = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase.from('care_plan_continuity_alerts').select('*').order('days_overdue', { ascending: false })
  rows.value = (data as AlertRow[]) ?? []
  loading.value = false
}
onMounted(load)

function patientName(row: AlertRow) {
  return `${row.first_name} ${row.last_name ?? ''}`.trim()
}
function cadenceLabel(row: AlertRow) {
  const unitEs = row.frequency_unit === 'week' ? 'semana' : 'mes'
  const unitEsPlural = row.frequency_unit === 'week' ? 'semanas' : 'meses'
  return t(
    `every ${row.frequency_value} ${row.frequency_unit}${row.frequency_value > 1 ? 's' : ''}`,
    `cada ${row.frequency_value} ${row.frequency_value > 1 ? unitEsPlural : unitEs}`,
  )
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
function openMessage(row: AlertRow) {
  messagingPatientId.value = row.patient_id
}
function onSent() {
  messagingPatientId.value = null
  load()
}
const messagingRow = computed(() => rows.value.find((r) => r.patient_id === messagingPatientId.value) ?? null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Care Plan Alerts', 'Alertas de plan de tratamiento')" :meta="`${rows.length} ${t('behind schedule', 'con retraso')}`" />

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="mb-4 text-[13px] text-ink-muted2">
        {{
          t(
            "Patients on an active care plan whose next visit is overdue by the plan's own cadence, with no future appointment booked.",
            'Pacientes con un plan de tratamiento activo cuya próxima visita está retrasada según la cadencia del propio plan, sin ninguna cita futura reservada.',
          )
        }}
      </p>

      <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <table class="w-full text-[13px]">
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
            <tr v-if="loading">
              <td colspan="7" class="px-3 py-6 text-center text-ink-faint">{{ t('Loading…', 'Cargando…') }}</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td colspan="7" class="px-3 py-6 text-center text-ink-faint">{{ t('No care plans behind schedule.', 'Ningún plan de tratamiento retrasado.') }}</td>
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
