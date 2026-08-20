<script setup lang="ts">
const props = defineProps<{
  appointmentId: string
  patientId: string
  appointmentTypeName?: string
  appointmentTypePriceCents?: number
}>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()

const { loading: summaryLoading, balanceCents, activeMembership, activePackages, refresh: refreshSummary } = usePatientFinancialSummary(
  () => props.patientId,
)

interface InvoiceRow { id: string; invoice_number: string; status: string; total_cents: number }
interface LineItemRow { id: string; description: string; quantity: number; price_cents: number }
interface PaymentRow { id: string; amount_cents: number; method: string; paid_at: string }

const invoice = ref<InvoiceRow | null>(null)
const lineItems = ref<LineItemRow[]>([])
const payments = ref<PaymentRow[]>([])
const loadingInvoice = ref(true)
const creatingInvoice = ref(false)

const paymentAmount = ref('')
const paymentMethod = ref<'card' | 'cash' | 'other'>('cash')
const savingPayment = ref(false)
const error = ref('')

const paidCents = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const balanceDueCents = computed(() => (invoice.value?.total_cents ?? 0) - paidCents.value)

async function loadInvoice() {
  loadingInvoice.value = true
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents')
    .eq('appointment_id', props.appointmentId)
    .maybeSingle()
  invoice.value = data
  if (data) {
    const [{ data: lines }, { data: pays }] = await Promise.all([
      supabase.from('invoice_line_items').select('id, description, quantity, price_cents').eq('invoice_id', data.id),
      supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', data.id).order('paid_at', { ascending: false }),
    ])
    lineItems.value = lines ?? []
    payments.value = pays ?? []
    paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  }
  loadingInvoice.value = false
}
onMounted(loadInvoice)

async function createInvoiceForAppointment() {
  creatingInvoice.value = true
  error.value = ''
  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
  const priceCents = props.appointmentTypePriceCents ?? 0
  const description = props.appointmentTypeName ?? 'Appointment'

  const { data: newInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      appointment_id: props.appointmentId,
      invoice_number: invoiceNumber,
      status: 'unpaid',
      total_cents: priceCents,
    })
    .select('id, invoice_number, status, total_cents')
    .single()

  if (invoiceError) {
    creatingInvoice.value = false
    error.value = invoiceError.message
    return
  }

  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: newInvoice.id,
    description,
    quantity: 1,
    price_cents: priceCents,
  })

  creatingInvoice.value = false
  await loadInvoice()
}

async function recordPayment() {
  if (!invoice.value) return
  error.value = ''
  const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  savingPayment.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: invoice.value.id,
    amount_cents: amountCents,
    method: paymentMethod.value,
  })

  const newPaid = paidCents.value + amountCents
  if (newPaid >= invoice.value.total_cents) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.value.id)
  }

  savingPayment.value = false
  await loadInvoice()
  await refreshSummary()
}
</script>

<template>
  <div class="space-y-4 text-sm">
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div v-if="summaryLoading" class="text-gray-400">Loading patient summary…</div>
      <div v-else class="space-y-1.5">
        <p>
          <span class="text-gray-500">Balance:</span>
          <span class="ml-1 font-medium" :class="balanceCents > 0 ? 'text-green-600' : balanceCents < 0 ? 'text-red-600' : 'text-gray-700'">
            {{
              balanceCents === 0
                ? '€0.00'
                : balanceCents > 0
                  ? `€${(balanceCents / 100).toFixed(2)} in credit`
                  : `€${(Math.abs(balanceCents) / 100).toFixed(2)} owed`
            }}
          </span>
        </p>
        <p v-if="activeMembership">
          <span class="text-gray-500">Membership:</span>
          <span class="ml-1 font-medium text-gray-900">{{ activeMembership.membership_name }}</span>
          <span class="ml-1 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">active</span>
        </p>
        <p v-else class="text-gray-400">No active membership</p>
        <div v-if="activePackages.length > 0">
          <span class="text-gray-500">Packages:</span>
          <span
            v-for="p in activePackages"
            :key="p.id"
            class="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
          >
            {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} left
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="text-gray-400">Loading invoice…</div>
    <div v-else-if="!invoice">
      <p class="text-gray-500">No invoice for this appointment yet.</p>
      <button
        v-if="can('billing_access')"
        type="button"
        :disabled="creatingInvoice"
        class="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        @click="createInvoiceForAppointment"
      >
        {{ creatingInvoice ? 'Creating…' : 'Create invoice for this appointment' }}
      </button>
    </div>
    <div v-else class="rounded-lg border border-gray-200 bg-white p-3">
      <div class="flex items-center justify-between">
        <NuxtLink :to="`/billing/${invoice.id}`" class="font-medium text-indigo-600 hover:text-indigo-700">{{ invoice.invoice_number }}</NuxtLink>
        <span
          class="rounded px-1.5 py-0.5 text-xs font-medium"
          :class="invoice.status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
        >
          {{ invoice.status }}
        </span>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="flex justify-between text-gray-700">
          <span>{{ line.description }} &times;{{ line.quantity }}</span>
          <span>€{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}</span>
        </li>
      </ul>
      <div class="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-right">
        <p class="text-gray-500">Total: €{{ (invoice.total_cents / 100).toFixed(2) }}</p>
        <p class="text-gray-500">Paid: €{{ (paidCents / 100).toFixed(2) }}</p>
        <p class="font-semibold text-gray-900">Balance due: €{{ (balanceDueCents / 100).toFixed(2) }}</p>
      </div>

      <form
        v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0"
        class="mt-3 flex items-end gap-2 border-t border-gray-100 pt-3"
        @submit.prevent="recordPayment"
      >
        <div>
          <label class="block text-xs font-medium text-gray-700">Amount (€)</label>
          <input v-model="paymentAmount" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700">Method</label>
          <select v-model="paymentMethod" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button type="submit" :disabled="savingPayment" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ savingPayment ? 'Recording…' : 'Record Payment' }}
        </button>
      </form>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-xs text-gray-500">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; €{{ (p.amount_cents / 100).toFixed(2) }}</li>
      </ul>
    </div>
    <p v-if="error" class="text-red-600">{{ error }}</p>
  </div>
</template>
