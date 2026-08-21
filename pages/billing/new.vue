<script setup lang="ts">
import type { Tables } from '~/types/database.types'

interface PatientOption { id: string; first_name: string; last_name: string | null }

interface LineItem {
  serviceId: string
  description: string
  quantity: number
  priceEuros: string
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const patients = ref<PatientOption[]>([])
const services = ref<Tables<'services_products'>[]>([])
const patientId = ref('')
const patientQuery = ref('')
const lines = ref<LineItem[]>([{ serviceId: '', description: '', quantity: 1, priceEuros: '' }])
const error = ref('')
const saving = ref(false)

onMounted(async () => {
  const [{ data: pts }, { data: svc }] = await Promise.all([
    supabase.from('patients').select('id, first_name, last_name').order('first_name'),
    supabase.from('services_products').select('*').order('name'),
  ])
  patients.value = pts ?? []
  services.value = svc ?? []
})

const filteredPatients = computed(() => {
  if (!patientQuery.value) return patients.value.slice(0, 20)
  const q = patientQuery.value.toLowerCase()
  return patients.value
    .filter((p) => `${p.first_name} ${p.last_name ?? ''}`.toLowerCase().includes(q))
    .slice(0, 20)
})
const selectedPatientLabel = computed(() => {
  const p = patients.value.find((p) => p.id === patientId.value)
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
    error.value = 'Select a patient.'
    return
  }
  const validLines = lines.value.filter((l) => l.description.trim() && parseFloat(l.priceEuros) >= 0)
  if (validLines.length === 0) {
    error.value = 'Add at least one line item.'
    return
  }
  saving.value = true

  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`

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
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Quick invoice">
      <UiBtn variant="secondary" @click="navigateTo('/billing')">Cancel</UiBtn>
      <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Create invoice' }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page p-6">
      <div class="mx-auto max-w-2xl space-y-4">
        <div class="rounded-card border border-line bg-surface p-6 shadow-card">
          <label class="block text-[12.5px] font-medium text-ink-500">Patient</label>
          <input
            v-model="patientQuery"
            type="text"
            :placeholder="selectedPatientLabel || 'Search patients…'"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <ul v-if="patientQuery" class="mt-1 max-h-40 overflow-y-auto rounded-ctl border border-line">
            <li
              v-for="p in filteredPatients"
              :key="p.id"
              class="cursor-pointer px-3 py-1.5 text-[13px] hover:bg-surface-subtle"
              @click="patientId = p.id; patientQuery = ''"
            >
              {{ p.first_name }} {{ p.last_name }}
            </li>
            <li v-if="filteredPatients.length === 0" class="px-3 py-1.5 text-[13px] text-ink-muted2">No matches</li>
          </ul>
          <p v-if="selectedPatientLabel && !patientQuery" class="mt-1 text-[13px] text-ink-muted">
            Selected: <span class="font-medium text-ink-900">{{ selectedPatientLabel }}</span>
          </p>
        </div>

        <div class="rounded-card border border-line bg-surface p-6 shadow-card">
          <label class="block text-[12.5px] font-medium text-ink-500">Services &amp; products</label>
          <div class="mt-2 space-y-2">
            <div v-for="(line, i) in lines" :key="i" class="flex items-center gap-2">
              <select
                v-model="line.serviceId"
                class="w-40 shrink-0 rounded-ctl border border-line-control px-2 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                @change="onServiceChange(line)"
              >
                <option value="">Custom</option>
                <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <input
                v-model="line.description"
                type="text"
                placeholder="Description"
                class="flex-1 rounded-ctl border border-line-control px-3 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <input
                v-model.number="line.quantity"
                type="number"
                min="1"
                class="w-16 rounded-ctl border border-line-control px-2 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <input
                v-model="line.priceEuros"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                class="w-24 rounded-ctl border border-line-control px-2 py-1.5 text-right font-mono text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <button type="button" class="text-ink-faint2 hover:text-danger-text" @click="removeLine(i)">✕</button>
            </div>
          </div>
          <button type="button" class="mt-2 text-[13px] font-medium text-brand-text hover:text-brand-hover" @click="addLine">
            + Add line
          </button>

          <div class="mt-4 flex justify-end border-t border-line-row2 pt-4 text-[13px]">
            <span class="font-semibold text-ink-900">
              Total: <span class="font-mono">€{{ (totalCents / 100).toFixed(2) }}</span>
            </span>
          </div>
        </div>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
