<script setup lang="ts">
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'
import { orderTypes } from '~/utils/appointmentTypes'

interface PatientOption { id: string; first_name: string; last_name: string | null }
interface AppointmentTypeOption { id: string; name: string; sort_order: number | null }
interface TeamMemberOption { id: string; full_name: string }
interface WaitlistRow {
  id: string
  status: 'waiting' | 'offered' | 'booked' | 'expired' | 'cancelled'
  created_at: string
  /** 'patient' when they joined it themselves from the app or portal; 'receptionist' when the AI receptionist added them. */
  source?: string | null
  /** When they can come, in words. */
  notes?: string | null
  offer_expires_at: string | null
  offered_starts_at: string | null
  patients: { id: string; first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

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
const loadError = ref(false)
const showOnlyActive = ref(true)

// The "only waiting / offered" toggle can be flipped back before the first
// list arrives; only the newest request may fill the table.
let loadToken = 0
async function load() {
  const token = ++loadToken
  loading.value = true
  let query = supabase
    .from('waitlist_entries')
    // appointment_types named by column: waitlist_entries points at it twice
    // (appointment_type_id, offered_appointment_type_id), and the bare embed
    // is refused as ambiguous (PGRST201) -- the WHOLE select, so this page
    // read nothing and said "No one on the waitlist" whatever was on it.
    .select('id, status, source, notes, created_at, offer_expires_at, offered_starts_at, patients(id, first_name, last_name), appointment_types:appointment_type_id(name), team_members:practitioner_id(full_name)')
    .order('created_at', { ascending: true })
  if (showOnlyActive.value) query = query.in('status', ['waiting', 'offered'])
  const { data, error } = await query
  if (token !== loadToken) return
  // A failed read is said, and does not pass for an empty list.
  loadError.value = !!error
  if (error) console.error('[waitlist] load error', error)
  else rows.value = (data as unknown as WaitlistRow[]) ?? []
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
    // Archived types are not offered for a new entry (Settings -> Appointment Types).
    supabase.from('appointment_types').select('id, name, sort_order').is('archived_at', null),
    supabase.from('team_members').select('id, full_name').order('full_name'),
  ])
  appointmentTypes.value = orderTypes(types ?? [])
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
// Back to the search box, with focus in it: the button that was pressed is gone.
async function changePatient() {
  selectedPatient.value = null
  await nextTick()
  document.getElementById(`${fieldId}-patientQuery`)?.focus()
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

// The app's own confirm dialog, as on Recalls, rather than the browser's.
const removing = ref<WaitlistRow | null>(null)
const removeBusy = ref(false)
async function cancelEntry() {
  const row = removing.value
  if (!row) return
  removeBusy.value = true
  // Only while still waiting: an entry offered a slot since the list loaded
  // must not be cancelled from under its live claim link. A refused or
  // missed update is said, not shown as done.
  const { data, error } = await supabase.from('waitlist_entries').update({ status: 'cancelled' }).eq('id', row.id).eq('status', 'waiting').select('id')
  removeBusy.value = false
  removing.value = null
  if (error) showToast(error.message, 'error')
  else if (!data?.length) showToast(t('Not removed: they have just been offered a slot.', 'No se ha quitado: se le acaba de ofrecer un hueco.'), 'error')
  await load()
}

function patientOptionName(p: PatientOption) {
  return `${p.first_name} ${p.last_name ?? ''}`.trim()
}
function patientName(row: WaitlistRow) {
  return row.patients ? `${row.patients.first_name} ${row.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Modal dialogs on this screen: focus stays inside while open, Escape closes,
// focus returns to what opened it (useFocusTrap, following each v-if).
const addTitleId = useId()
const addPanel = ref<HTMLElement | null>(null)
useFocusTrap(addPanel, () => (addOpen.value = false), () => addOpen.value)

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()

// The shared empty state, drawn inside the table's own card: its border and
// shadow would otherwise put a card inside a card.
const INSET_EMPTY = '!py-0 [&>div]:max-w-none [&>div]:gap-3 [&>div]:border-0 [&>div]:py-7 [&>div]:shadow-none'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Waitlist', 'Lista de espera')" :meta="loading || loadError ? undefined : `${rows.length} ${t('entries', 'registros')}`">
      <UiBtn variant="primary" @click="openAdd">{{ t('+ Add to waitlist', '+ Añadir a la lista') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <WaitlistOfferSettings />
      <label class="mb-3 flex min-h-9 w-fit items-center gap-2 text-[12.5px] text-ink-600 touch:min-h-11">
        <input v-model="showOnlyActive" type="checkbox" class="h-4 w-4 accent-brand" />
        {{ t('Show only waiting / offered', 'Mostrar solo esperando / con oferta') }}
      </label>

      <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <UiEmptyState
          v-if="!loading && loadError"
          :title="t(`Couldn't load the waitlist`, 'No se ha podido cargar la lista de espera')"
          :description="t('The connection dropped or the server took too long to answer. Nothing has been changed.', 'Se ha cortado la conexión o el servidor ha tardado demasiado en responder. No se ha cambiado nada.')"
          :class="INSET_EMPTY"
          data-cy="waitlist-load-error"
        >
          <template #icon>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          </template>
          <template #actions>
            <UiBtn @click="load()">{{ t('Try again', 'Reintentar') }}</UiBtn>
          </template>
        </UiEmptyState>
        <UiEmptyState
          v-else-if="!loading && rows.length === 0"
          :title="t('No one on the waitlist', 'Nadie en la lista de espera')"
          :class="INSET_EMPTY"
          data-cy="waitlist-empty"
        >
          <template #icon>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </template>
        </UiEmptyState>
        <table v-else class="w-full min-w-[640px] text-[13px]">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">
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
            <tr v-for="row in loading ? [] : rows" :key="row.id">
              <td class="px-3 py-2">
                <!-- A link to the record, as on Recalls and Care plan alerts. -->
                <NuxtLink v-if="row.patients" :to="`/patients/${row.patients.id}`" class="whitespace-nowrap font-medium text-ink-900 hover:text-brand-text">{{ patientName(row) }}</NuxtLink>
                <span v-else class="whitespace-nowrap text-ink-900">{{ patientName(row) }}</span>
                <!-- Its own line: run on after the name, it wrapped mid-phrase
                     under it in a narrow column. -->
                <span v-if="row.source === 'patient'" class="block text-[12px] text-ink-muted2" data-cy="waitlist-self-added">{{ t('Joined themselves', 'Se apuntó el paciente') }}</span>
                <span v-else-if="row.source === 'receptionist'" class="block text-[12px] text-ink-muted2" data-cy="waitlist-receptionist-added">{{ t('Added by the AI receptionist', 'Apuntado por la recepcionista IA') }}</span>
                <div v-if="row.notes" class="mt-0.5 text-[12px] text-ink-muted2" data-cy="waitlist-notes">{{ row.notes }}</div>
              </td>
              <td class="px-3 py-2 text-ink-muted2">
                {{ row.appointment_types?.name ?? t('Any type', 'Cualquier tipo') }} ·
                {{ row.team_members?.full_name ?? t('Any practitioner', 'Cualquier profesional') }}
              </td>
              <td class="px-3 py-2">
                <UiPill :tone="STATUS_TONE[row.status]" class="whitespace-nowrap">{{ t(...STATUS_LABEL[row.status]) }}</UiPill>
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
                <UiIconBtn v-if="row.status === 'waiting'" icon="trash" tone="danger" :label="t('Remove from waitlist', 'Quitar de la lista de espera')" @click="removing = row" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="addOpen" class="fixed inset-0 z-50 flex justify-end bg-scrim/40" @click.self="addOpen = false">
      <div ref="addPanel" role="dialog" aria-modal="true" :aria-labelledby="addTitleId" class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-4 shadow-popover sm:p-6">
        <div class="flex items-center justify-between">
          <h2 :id="addTitleId" class="text-[15px] font-semibold text-ink-900">{{ t('Add to waitlist', 'Añadir a la lista de espera') }}</h2>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="-mr-2 flex h-9 w-9 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-600 touch:h-11 touch:w-11" @click="addOpen = false"><UiCloseIcon /></button>
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="addToWaitlist">
          <div>
            <label :for="`${fieldId}-patientQuery`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Patient', 'Paciente') }}</label>
            <!-- The chosen patient is shown as chosen. It used to be only the
                 search box's grey placeholder, which reads as nothing picked. -->
            <div v-if="selectedPatient" class="mt-1 flex h-9 items-center gap-2 rounded-ctl border border-brand-tintBorder bg-brand-tint pl-3 pr-1 touch:h-11" data-cy="waitlist-add-patient">
              <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-brand-text">{{ patientOptionName(selectedPatient) }}</span>
              <UiBtn variant="ghost" size="sm" @click="changePatient">{{ t('Change', 'Cambiar') }}</UiBtn>
            </div>
            <template v-else>
              <input :id="`${fieldId}-patientQuery`"
                v-model="patientQuery"
                type="text"
                autocomplete="off"
                :placeholder="t('Search by name…', 'Buscar por nombre…')"
                class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none touch:h-11"
              />
              <!-- Buttons, so a result can be reached and picked from the keyboard. -->
              <ul v-if="patientQuery" class="mt-1 max-h-48 overflow-y-auto rounded-ctl border border-line py-1">
                <li v-for="p in patientResults" :key="p.id">
                  <button type="button" class="flex min-h-9 w-full items-center px-3 text-left text-[13px] text-ink-700 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none touch:min-h-11" @click="pickPatient(p)">
                    {{ patientOptionName(p) }}
                  </button>
                </li>
                <li v-if="patientResults.length === 0" class="px-3 py-2 text-[13px] text-ink-faint">{{ t('No matches', 'Sin resultados') }}</li>
              </ul>
            </template>
          </div>

          <div>
            <label :for="`${fieldId}-appointmentTypeId`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Appointment type', 'Tipo de cita') }}</label>
            <select :id="`${fieldId}-appointmentTypeId`" v-model="appointmentTypeId" class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11">
              <option value="">{{ t('Any type', 'Cualquier tipo') }}</option>
              <option v-for="a in appointmentTypes" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>

          <div>
            <label :for="`${fieldId}-practitionerId`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Practitioner', 'Profesional') }}</label>
            <select :id="`${fieldId}-practitionerId`" v-model="practitionerId" class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11">
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

    <UiConfirmDialog
      v-if="removing"
      :title="t(`Remove ${patientName(removing)} from the waitlist?`, `¿Quitar a ${patientName(removing)} de la lista de espera?`)"
      :confirm-label="t('Remove', 'Quitar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="removeBusy"
      @confirm="cancelEntry"
      @cancel="removing = null"
    />
  </div>
</template>
