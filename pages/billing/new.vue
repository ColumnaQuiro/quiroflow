<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'
import type { Tables } from '~/types/database.types'

interface PatientOption { id: string; first_name: string; last_name: string | null }
type ServiceOption = Pick<Tables<'services_products'>, 'id' | 'name' | 'price_cents'>

interface LineItem {
  serviceId: string
  description: string
  quantity: number
  priceEuros: string
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const t = useT()

// Searched on the server as you type, as the Waitlist does. The whole patients
// table used to load here, capped at PostgREST's 1,000 rows, so anyone past
// that was unfindable and a ?patient_id= among them preselected nobody.
const patientResults = ref<PatientOption[]>([])
const searchingPatients = ref(false)
const selectedPatient = ref<PatientOption | null>(null)
const services = ref<ServiceOption[]>([])
const patientId = computed(() => selectedPatient.value?.id ?? '')
const patientQuery = ref('')
const lines = ref<LineItem[]>([{ serviceId: '', description: '', quantity: 1, priceEuros: '' }])
const error = ref('')
const saving = ref(false)

onMounted(async () => {
  // Preselects the patient when arriving from their own Account Ledger
  // ("New Invoice" there links here with ?patient_id= rather than opening a
  // separate modal, so this page needs to skip its own patient search step).
  const requestedId = route.query.patient_id
  const [{ data: svc }, requested] = await Promise.all([
    // Products are sold from the patient's Money tab, which takes their stock
    // and issues the factura at their own IVA; a manual receipt does neither.
    supabase.from('services_products').select('id, name, price_cents').eq('kind', 'service').order('name'),
    typeof requestedId === 'string'
      ? supabase.from('patients').select('id, first_name, last_name').eq('id', requestedId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  services.value = svc ?? []
  if (requested.data && !selectedPatient.value) selectedPatient.value = requested.data
})

let searchDebounce: ReturnType<typeof setTimeout> | undefined
let searchToken = 0
watch(patientQuery, (q) => {
  clearTimeout(searchDebounce)
  const token = ++searchToken
  const term = sanitizeSearchToken(q.trim())
  if (!term) {
    patientResults.value = []
    searchingPatients.value = false
    return
  }
  searchingPatients.value = true
  searchDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .ilike('search_name', `%${normalizeSearchTerm(term)}%`)
      .order('first_name')
      .limit(20)
    if (token !== searchToken) return
    patientResults.value = data ?? []
    searchingPatients.value = false
  }, 250)
})
function pickPatient(p: PatientOption) {
  selectedPatient.value = p
  patientQuery.value = ''
}
const selectedPatientLabel = computed(() => {
  const p = selectedPatient.value
  return p ? `${p.first_name} ${p.last_name ?? ''}` : ''
})

function onServiceChange(line: LineItem) {
  const svc = services.value.find((s) => s.id === line.serviceId)
  if (svc) {
    line.description = svc.name
    line.priceEuros = (svc.price_cents / 100).toFixed(2)
  }
}

function addLine() {
  lines.value.push({ serviceId: '', description: '', quantity: 1, priceEuros: '' })
}
function removeLine(index: number) {
  lines.value.splice(index, 1)
}

const totalCents = computed(() =>
  lines.value.reduce((sum, l) => sum + Math.round((parseFloat(l.priceEuros) || 0) * 100) * (l.quantity || 0), 0),
)

async function save() {
  error.value = ''
  if (!patientId.value) {
    error.value = t('Select a patient.', 'Selecciona un paciente.')
    return
  }
  const validLines = lines.value.filter((l) => l.description.trim() && parseFloat(l.priceEuros) >= 0)
  if (validLines.length === 0) {
    error.value = t('Add at least one line item.', 'Añade al menos un concepto.')
    return
  }
  saving.value = true

  const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
  if (numberError || !invoiceNumber) {
    saving.value = false
    error.value = numberError?.message ?? t('Could not allocate a receipt number.', 'No se ha podido asignar un número de recibo.')
    return
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: patientId.value,
      invoice_number: invoiceNumber,
      status: 'unpaid',
      total_cents: totalCents.value,
    })
    .select('id')
    .single()

  if (invoiceError) {
    saving.value = false
    error.value = invoiceError.message
    return
  }

  const { error: linesError } = await supabase.from('invoice_line_items').insert(
    validLines.map((l) => ({
      account_id: store.accountId!,
      invoice_id: invoice.id,
      service_id: l.serviceId || null,
      description: l.description.trim(),
      quantity: l.quantity,
      price_cents: Math.round(parseFloat(l.priceEuros) * 100),
    })),
  )

  saving.value = false
  if (linesError) {
    error.value = linesError.message
    return
  }
  await navigateTo(`/billing/${invoice.id}`)
}

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Quick receipt', 'Recibo rápido')">
      <UiBtn variant="secondary" @click="navigateTo('/billing')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Create receipt', 'Crear recibo') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page p-4 sm:p-6">
      <div class="mx-auto max-w-2xl space-y-4">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card sm:p-6">
          <label :for="`${fieldId}-patientQuery`" class="block text-[12.5px] font-medium text-ink-500">{{ t('Patient', 'Paciente') }}</label>
          <input :id="`${fieldId}-patientQuery`"
            v-model="patientQuery"
            type="text"
            :placeholder="selectedPatientLabel || t('Search patients…', 'Buscar pacientes…')"
            class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
          />
          <!-- Buttons, so a patient can be picked from the keyboard as well. -->
          <ul v-if="patientQuery" class="mt-1 max-h-48 overflow-y-auto rounded-ctl border border-line bg-surface">
            <li v-if="searchingPatients && patientResults.length === 0" class="px-3 py-2"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></li>
            <li v-for="p in patientResults" :key="p.id">
              <button
                type="button"
                class="flex h-9 w-full min-w-0 items-center px-3 text-left text-[13px] text-ink-700 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none touch:h-11"
                @click="pickPatient(p)"
              >
                <span class="truncate">{{ p.first_name }} {{ p.last_name }}</span>
              </button>
            </li>
            <li v-if="!searchingPatients && patientResults.length === 0" class="px-3 py-2 text-[13px] text-ink-muted2">{{ t('No matches', 'Sin coincidencias') }}</li>
          </ul>
          <p v-if="selectedPatientLabel && !patientQuery" class="mt-1 text-[13px] text-ink-muted">
            {{ t('Selected:', 'Seleccionado:') }} <span class="font-medium text-ink-900">{{ selectedPatientLabel }}</span>
          </p>
        </div>

        <div class="rounded-card border border-line bg-surface p-4 shadow-card sm:p-6">
          <p class="text-[12.5px] font-medium text-ink-500">{{ t('Services & products', 'Servicios y productos') }}</p>
          <div class="mt-2 space-y-2">
            <!-- One row on a desktop. On a phone the service and the
                 description take a line each and quantity and price share the
                 last: in one row the description ran off the card and the
                 amount was not on screen at all. -->
            <div v-for="(line, i) in lines" :key="i" class="flex flex-wrap items-center gap-2 border-b border-line-row2 pb-3 last:border-b-0 sm:flex-nowrap sm:border-b-0 sm:pb-0">
              <select
                v-model="line.serviceId"
                :aria-label="t('Service', 'Servicio')"
                class="h-9 w-full shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11 sm:w-40"
                @change="onServiceChange(line)"
              >
                <option value="">{{ t('Custom', 'Personalizado') }}</option>
                <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <input
                v-model="line.description"
                type="text"
                :placeholder="t('Description', 'Descripción')"
                :aria-label="t('Description', 'Descripción')"
                class="h-9 w-full min-w-0 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11 sm:w-auto sm:flex-1"
              />
              <input
                v-model.number="line.quantity"
                type="number"
                min="1"
                :aria-label="t('Quantity', 'Cantidad')"
                class="h-9 w-16 rounded-ctl border border-line-control bg-surface px-2 text-right font-mono text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
              />
              <input
                v-model="line.priceEuros"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                :aria-label="t('Price (€)', 'Precio (€)')"
                class="h-9 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-right font-mono text-[13px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11 sm:w-24 sm:flex-none"
              />
              <button
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-ctlSm text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger-text touch:h-11 touch:w-11"
                :aria-label="t('Remove line', 'Quitar línea')"
                :title="t('Remove line', 'Quitar línea')"
                @click="removeLine(i)"
              >
                <UiCloseIcon />
              </button>
            </div>
          </div>
          <button type="button" class="mt-2 inline-flex h-8 items-center text-[13px] font-medium text-brand-text hover:text-brand-hover touch:h-11" @click="addLine">
            + {{ t('Add line', 'Añadir línea') }}
          </button>

          <div class="mt-4 flex justify-end border-t border-line-row2 pt-4 text-[13px]">
            <span class="font-semibold text-ink-900">
              {{ t('Total:', 'Total:') }} <span class="font-mono">{{ formatEur(totalCents) }}</span>
            </span>
          </div>
        </div>

        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
