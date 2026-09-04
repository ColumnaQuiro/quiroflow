<script setup lang="ts">
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

interface PatientOption { id: string; first_name: string; last_name: string | null }
interface AppointmentTypeOption { id: string; name: string }
interface TeamMemberOption { id: string; full_name: string }
interface WaitlistRow {
  id: string
  status: 'waiting' | 'offered' | 'booked' | 'expired' | 'cancelled'
  created_at: string
  offer_expires_at: string | null
  offered_starts_at: string | null
  patients: { id: string; first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const STATUS_LABEL: Record<WaitlistRow['status'], [string, string]> = {
  waiting: ['Waiting', 'Esperando'],
  offered: ['Offer sent', 'Oferta enviada'],
  booked: ['Booked', 'Reservada'],
  expired: ['Offer expired', 'Oferta caducada'],
  cancelled: ['Cancelled', 'Cancelada'],
}
const STATUS_TONE: Record<WaitlistRow['status'], 'neutral' | 'brand' | 'success' | 'danger'> = {
  waiting: 'neutral',
  offered: 'brand',
  booked: 'success',
  expired: 'danger',
  cancelled: 'danger',
}

const rows = ref<WaitlistRow[]>([])
const loading = ref(true)
const showOnlyActive = ref(true)

async function load() {
  loading.value = true
  let query = supabase
    .from('waitlist_entries')
    .select('id, status, created_at, offer_expires_at, offered_starts_at, patients(id, first_name, last_name), appointment_types(name), team_members:practitioner_id(full_name)')
    .order('created_at', { ascending: true })
  if (showOnlyActive.value) query = query.in('status', ['waiting', 'offered'])
  const { data } = await query
  rows.value = (data as unknown as WaitlistRow[]) ?? []
  loading.value = false
}
onMounted(load)
watch(showOnlyActive, load)

// -- Add to waitlist --------------------------------------------------
const addOpen = ref(false)
const patientQuery = ref('')
const patientResults = ref<PatientOption[]>([])
const selectedPatient = ref<PatientOption | null>(null)
const appointmentTypes = ref<AppointmentTypeOption[]>([])
const teamMembers = ref<TeamMemberOption[]>([])
const appointmentTypeId = ref('')
const practitionerId = ref('')
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const [{ data: types }, { data: members }] = await Promise.all([
    supabase.from('appointment_types').select('id, name').order('name'),
    supabase.from('team_members').select('id, full_name').order('full_name'),
  ])
  appointmentTypes.value = types ?? []
  teamMembers.value = members ?? []
})

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(patientQuery, (q) => {
  clearTimeout(searchDebounce)
  if (!q.trim()) {
    patientResults.value = []
    return
  }
  searchDebounce = setTimeout(async () => {
    const token = sanitizeSearchToken(q.trim())
    const { data } = await supabase.from('patients').select('id, first_name, last_name').ilike('search_name', `%${normalizeSearchTerm(token)}%`).limit(10)
    patientResults.value = data ?? []
  }, 250)
})
function pickPatient(p: PatientOption) {
  selectedPatient.value = p
  patientQuery.value = ''
  patientResults.value = []
}
function openAdd() {
  addOpen.value = true
  selectedPatient.value = null
  patientQuery.value = ''
  appointmentTypeId.value = ''
  practitionerId.value = ''
  error.value = ''
}
async function addToWaitlist() {
  if (!selectedPatient.value) {
    error.value = t('Select a patient.', 'Selecciona un paciente.')
    return
  }
  if (!store.currentClinicId) {
    error.value = t('No clinic selected.', 'No hay ninguna clínica seleccionada.')
    return
  }
  saving.value = true
  const { error: insertError } = await supabase.from('waitlist_entries').insert({
    account_id: store.accountId!,
    clinic_id: store.currentClinicId,
    patient_id: selectedPatient.value.id,
    appointment_type_id: appointmentTypeId.value || null,
    practitioner_id: practitionerId.value || null,
    created_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  addOpen.value = false
  await load()
}

async function cancelEntry(row: WaitlistRow) {
  if (!confirm(t('Remove this patient from the waitlist?', '¿Quitar a este paciente de la lista de espera?'))) return
  await supabase.from('waitlist_entries').update({ status: 'cancelled' }).eq('id', row.id)
  await load()
}

function patientName(row: WaitlistRow) {
  return row.patients ? `${row.patients.first_name} ${row.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Waitlist', 'Lista de espera')" :meta="`${rows.length} ${t('entries', 'registros')}`">
      <UiBtn variant="primary" @click="openAdd">{{ t('+ Add to waitlist', '+ Añadir a la lista') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <label class="mb-3 flex w-fit items-center gap-1.5 text-[12.5px] text-ink-600">
        <input v-model="showOnlyActive" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
        {{ t('Show only waiting / offered', 'Mostrar solo esperando / con oferta') }}
      </label>

      <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <table class="w-full text-[13px]">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Wants', 'Quiere') }}</th>
              <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
              <th class="px-3 py-2">{{ t('Offered slot', 'Cita ofrecida') }}</th>
              <th class="px-3 py-2">{{ t('Waiting since', 'Esperando desde') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-if="loading">
              <tr v-for="i in 4" :key="i">
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-28 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-24 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-5 w-16 rounded-pill" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-20 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-16 rounded-ctlSm" /></td>
                <td class="px-3 py-2.5" />
              </tr>
            </template>
            <tr v-else-if="rows.length === 0">
              <td colspan="6" class="px-3 py-6 text-center text-ink-faint">{{ t('No one on the waitlist.', 'Nadie en la lista de espera.') }}</td>
            </tr>
            <tr v-for="row in rows" :key="row.id">
              <td class="px-3 py-2 text-ink-900">{{ patientName(row) }}</td>
              <td class="px-3 py-2 text-ink-muted2">
                {{ row.appointment_types?.name ?? t('Any type', 'Cualquier tipo') }} ·
                {{ row.team_members?.full_name ?? t('Any practitioner', 'Cualquier profesional') }}
              </td>
              <td class="px-3 py-2">
                <UiPill :tone="STATUS_TONE[row.status]">{{ t(...STATUS_LABEL[row.status]) }}</UiPill>
              </td>
              <td class="px-3 py-2 text-ink-muted2">
                <template v-if="row.status === 'offered'">
                  {{ formatDate(row.offered_starts_at) }}
                  <span class="text-ink-faint">· {{ t('expires', 'caduca') }} {{ formatDate(row.offer_expires_at) }}</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatDate(row.created_at) }}</td>
              <td class="px-3 py-2 text-right">
                <button v-if="row.status === 'waiting'" type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click="cancelEntry(row)">
                  {{ t('Remove', 'Quitar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="addOpen" class="fixed inset-0 z-50 flex justify-end bg-ink-900/30" @click.self="addOpen = false">
      <div class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-popover">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Add to waitlist', 'Añadir a la lista de espera') }}</h2>
          <button type="button" class="text-ink-faint hover:text-ink-600" @click="addOpen = false">✕</button>
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="addToWaitlist">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Patient', 'Paciente') }}</label>
            <input
              v-model="patientQuery"
              type="text"
              :placeholder="selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name ?? ''}` : t('Search by name…', 'Buscar por nombre…')"
              class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
            />
            <ul v-if="patientQuery" class="mt-1 max-h-40 overflow-y-auto rounded-ctl border border-line">
              <li v-for="p in patientResults" :key="p.id" class="cursor-pointer px-3 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle" @click="pickPatient(p)">
                {{ p.first_name }} {{ p.last_name }}
              </li>
              <li v-if="patientResults.length === 0" class="px-3 py-1.5 text-[13px] text-ink-faint">{{ t('No matches', 'Sin resultados') }}</li>
            </ul>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Appointment type', 'Tipo de cita') }}</label>
            <select v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="">{{ t('Any type', 'Cualquier tipo') }}</option>
              <option v-for="a in appointmentTypes" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Practitioner', 'Profesional') }}</label>
            <select v-model="practitionerId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
              <option value="">{{ t('Any practitioner', 'Cualquier profesional') }}</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>

          <p class="text-[12px] text-ink-muted2">
            {{
              t(
                "When a matching appointment is cancelled, this patient is offered the slot automatically (oldest entry first), with a link to claim it.",
                'Cuando se cancela una cita que coincide, se le ofrece automáticamente esta plaza (por orden de antigüedad), con un enlace para reservarla.',
              )
            }}
          </p>

          <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <UiBtn variant="secondary" type="button" :disabled="saving" @click="addOpen = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
