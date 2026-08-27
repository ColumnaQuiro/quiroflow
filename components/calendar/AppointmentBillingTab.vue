<script setup lang="ts">
const props = defineProps<{
  appointmentId: string
  patientId: string
  appointmentTypeName?: string
  appointmentTypePriceCents?: number
}>()

const emit = defineEmits<{ completed: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { fire } = useAutomations()

const { loading: summaryLoading, balanceCents, activeMembership, activePackages, refresh: refreshSummary } = usePatientFinancialSummary(
  () => props.patientId,
)

interface InvoiceRow { id: string; invoice_number: string; status: string; total_cents: number }
interface LineItemRow { id: string; description: string; quantity: number; price_cents: number }
interface PaymentRow { id: string; amount_cents: number; method: string; paid_at: string }
interface ServiceOption { id: string; name: string; price_cents: number }

const invoice = ref<InvoiceRow | null>(null)
const lineItems = ref<LineItemRow[]>([])
const payments = ref<PaymentRow[]>([])
const services = ref<ServiceOption[]>([])
const addServiceId = ref('')
const loadingInvoice = ref(true)
const hasFutureAppointment = ref(true)

const paymentAmount = ref('')
// 'credit' triggers a compound operation: a payments row (method: 'credit')
// plus a negative account_credits row -- the same pattern the patient's main
// Billing tab already uses for "Apply credit" (BillingTab.vue).
const paymentMethod = ref<'card' | 'cash' | 'credit'>('cash')
const savingPayment = ref(false)
const error = ref('')

const sendingInvoice = ref(false)
const sendResult = ref('')
async function sendInvoiceEmail() {
  if (!invoice.value) return
  sendingInvoice.value = true
  sendResult.value = ''
  try {
    await useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' })
    sendResult.value = 'Sent'
  } catch (e: any) {
    sendResult.value = e?.data?.message ?? 'Failed to send'
  }
  sendingInvoice.value = false
}

const paidCents = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const balanceDueCents = computed(() => (invoice.value?.total_cents ?? 0) - paidCents.value)

async function loadFutureAppointmentCheck() {
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', props.patientId)
    .neq('id', props.appointmentId)
    .neq('status', 'cancelled')
    .gt('starts_at', new Date().toISOString())
  hasFutureAppointment.value = (count ?? 0) > 0
}

async function ensureInvoice(): Promise<InvoiceRow | null> {
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents')
    .eq('appointment_id', props.appointmentId)
    .maybeSingle()

  if (existing) return existing
  if (!can('billing_access')) return null

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
    error.value = invoiceError.message
    return null
  }

  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: newInvoice.id,
    description,
    quantity: 1,
    price_cents: priceCents,
  })

  return newInvoice
}

async function loadInvoice() {
  loadingInvoice.value = true
  error.value = ''

  const inv = await ensureInvoice()

  invoice.value = inv
  if (inv) {
    const [{ data: lines }, { data: pays }] = await Promise.all([
      supabase.from('invoice_line_items').select('id, description, quantity, price_cents').eq('invoice_id', inv.id),
      supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', inv.id).order('paid_at', { ascending: false }),
    ])
    lineItems.value = lines ?? []
    payments.value = pays ?? []
    paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  }
  loadingInvoice.value = false
}

onMounted(async () => {
  const { data: svc } = await supabase.from('services_products').select('id, name, price_cents').order('name')
  services.value = svc ?? []
  await loadFutureAppointmentCheck()
  await loadInvoice()
})

async function recalcInvoiceTotal() {
  if (!invoice.value) return
  const totalCents = lineItems.value.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
  await supabase.from('invoices').update({ total_cents: totalCents }).eq('id', invoice.value.id)
  invoice.value.total_cents = totalCents
  paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
}

async function addLineItem() {
  if (!invoice.value || !addServiceId.value) return
  const svc = services.value.find((s) => s.id === addServiceId.value)
  if (!svc) return

  const { data } = await supabase
    .from('invoice_line_items')
    .insert({
      account_id: store.accountId!,
      invoice_id: invoice.value.id,
      service_id: svc.id,
      description: svc.name,
      quantity: 1,
      price_cents: svc.price_cents,
    })
    .select('id, description, quantity, price_cents')
    .single()

  if (data) lineItems.value.push(data)
  addServiceId.value = ''
  await recalcInvoiceTotal()
}

async function removeLineItem(item: LineItemRow) {
  await supabase.from('invoice_line_items').delete().eq('id', item.id)
  lineItems.value = lineItems.value.filter((l) => l.id !== item.id)
  await recalcInvoiceTotal()
}

async function usePackageSession(pkg: { id: string; package_name: string; sessions_used: number; sessions_total: number; price_cents: number }) {
  if (pkg.sessions_used >= pkg.sessions_total || !invoice.value) return
  savingPayment.value = true

  await supabase.from('package_purchases').update({ sessions_used: pkg.sessions_used + 1 }).eq('id', pkg.id)
  // A package session spends real credit -- a payment (method 'credit')
  // plus a matching negative account_credits row, same compound pattern as
  // "Credit on account" below. Previously this just flipped the invoice to
  // 'paid' with no payment behind it at all, which silently broke
  // balanceCents (paid never caught up to invoiced) for every
  // package-covered visit.
  //
  // The payment (marking THIS invoice paid) is the visit's own listed
  // price, same as any other invoice. The credit withdrawal is a separate
  // number: the bono's own per-session value (total price ÷ total
  // sessions), which is what the patient actually paid per visit when they
  // bought the bono -- it has nothing to do with what any one appointment
  // type happens to be priced at. A 10-session, €1000 bono draws €100 per
  // session regardless of whether this particular visit's invoice reads
  // €55 or €150.
  const remainingCents = invoice.value.total_cents - paidCents.value
  const perSessionCents = Math.round(pkg.price_cents / pkg.sessions_total)
  if (remainingCents > 0) {
    await supabase.from('payments').insert({
      account_id: store.accountId!,
      invoice_id: invoice.value.id,
      amount_cents: remainingCents,
      method: 'credit',
    })
  }
  if (perSessionCents > 0) {
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -perSessionCents,
      reason: `Package session: ${pkg.package_name}`,
      invoice_id: invoice.value.id,
      created_by: store.teamMember?.id ?? null,
    })
  }
  await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.value.id)
  // Mirrors recordPayment()'s full-payment side effect: a package session
  // covers the visit, so completing it works the same as taking cash/card --
  // including the same auto-send-if-enabled behavior below.
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointmentId)
  emit('completed')
  fire('invoice.paid', { patientId: props.patientId, appointmentId: props.appointmentId, invoiceId: invoice.value.id })
  fire('appointment.completed', { patientId: props.patientId, appointmentId: props.appointmentId })

  const { data: patientForSend } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', props.patientId).maybeSingle()
  if (patientForSend?.invoice_email_enabled && patientForSend.email) {
    useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' }).catch(() => {})
  }

  savingPayment.value = false
  await loadInvoice()
  await refreshSummary()
  await loadFutureAppointmentCheck()
}

async function recordPayment() {
  if (!invoice.value) return
  error.value = ''
  const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  if (paymentMethod.value === 'credit' && amountCents > balanceCents.value) {
    error.value = 'Amount exceeds available credit.'
    return
  }
  savingPayment.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: invoice.value.id,
    amount_cents: amountCents,
    method: paymentMethod.value,
  })
  if (paymentMethod.value === 'credit') {
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -amountCents,
      reason: `Applied to invoice ${invoice.value.invoice_number}`,
      invoice_id: invoice.value.id,
      created_by: store.teamMember?.id ?? null,
    })
  }

  const newPaid = paidCents.value + amountCents
  if (newPaid >= invoice.value.total_cents) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.value.id)
    // Recording full payment implies the visit happened -- mirrors PracticeHub's
    // "Process" button, which finalizes the invoice and completes the visit
    // in one action rather than requiring a separate status change.
    await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointmentId)
    emit('completed')
    fire('invoice.paid', { patientId: props.patientId, appointmentId: props.appointmentId, invoiceId: invoice.value.id })
    fire('appointment.completed', { patientId: props.patientId, appointmentId: props.appointmentId })

    const { data: patient } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', props.patientId).maybeSingle()
    if (patient?.invoice_email_enabled && patient.email) {
      // Best-effort -- a failed auto-send shouldn't block having just
      // completed the visit and taken payment.
      useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' }).catch(() => {})
    }
  }

  savingPayment.value = false
  await loadInvoice()
  await refreshSummary()
  await loadFutureAppointmentCheck()
}
</script>

<template>
  <div class="space-y-4 text-sm">
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div v-if="summaryLoading" class="text-gray-400">Loading patient summary…</div>
      <div v-else class="space-y-1.5">
        <p class="flex items-center gap-1.5">
          <span class="text-gray-500">Balance:</span>
          <UiBalancePill v-if="balanceCents !== 0" :balance-cents="balanceCents" />
          <span v-else class="font-medium text-gray-700">€0.00</span>
        </p>
        <p v-if="activeMembership">
          <span class="text-gray-500">Membership:</span>
          <span class="ml-1 font-medium text-gray-900">{{ activeMembership.membership_name }}</span>
          <span class="ml-1 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">active</span>
        </p>
        <p v-else class="text-gray-400">No active membership</p>
        <div v-if="activePackages.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-gray-500">Packages:</span>
          <span
            v-for="p in activePackages"
            :key="p.id"
            class="inline-flex items-center gap-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
          >
            {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} left
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="text-gray-400">Loading invoice…</div>
    <p v-else-if="!invoice && !can('billing_access')" class="text-gray-400">No invoice for this appointment yet.</p>
    <div v-else-if="invoice" class="rounded-lg border border-gray-200 bg-white p-3">
      <div class="flex items-center justify-between">
        <NuxtLink :to="`/billing/${invoice.id}`" class="font-medium text-indigo-600 hover:text-indigo-700">{{ invoice.invoice_number }}</NuxtLink>
        <div class="flex items-center gap-2">
          <span
            class="rounded px-1.5 py-0.5 text-xs font-medium"
            :class="invoice.status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
          >
            {{ invoice.status }}
          </span>
          <span v-if="sendResult" class="text-xs text-gray-400">{{ sendResult }}</span>
          <button
            v-else-if="can('billing_access')"
            type="button"
            class="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            :disabled="sendingInvoice"
            @click="sendInvoiceEmail"
          >
            {{ sendingInvoice ? 'Sending…' : 'Send invoice' }}
          </button>
        </div>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="flex items-center justify-between text-gray-700">
          <span>{{ line.description }} &times;{{ line.quantity }}</span>
          <span class="flex items-center gap-2">
            €{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}
            <button
              v-if="can('billing_access') && invoice.status !== 'paid'"
              type="button"
              class="text-gray-400 hover:text-red-600"
              @click="removeLineItem(line)"
            >
              ✕
            </button>
          </span>
        </li>
      </ul>

      <select
        v-if="can('billing_access') && invoice.status !== 'paid'"
        v-model="addServiceId"
        class="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        @change="addLineItem"
      >
        <option value="" disabled>-- Add Service/Product --</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} (€{{ (s.price_cents / 100).toFixed(2) }})</option>
      </select>

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
            <option v-if="balanceCents > 0" value="credit">Credit on account (€{{ (balanceCents / 100).toFixed(2) }} available)</option>
          </select>
        </div>
        <button type="submit" :disabled="savingPayment" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ savingPayment ? 'Processing…' : 'Process' }}
        </button>
      </form>
      <div
        v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2"
      >
        <span class="text-xs text-gray-500">Or use a package session:</span>
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          class="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          @click="usePackageSession(p)"
        >
          {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} left)
        </button>
      </div>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-xs text-gray-500">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; €{{ (p.amount_cents / 100).toFixed(2) }}</li>
      </ul>

      <p v-if="!hasFutureAppointment" class="mt-3 border-t border-gray-100 pt-3 text-sm font-medium text-red-600">
        No future appointment — this patient will show up in Recalls automatically.
      </p>
    </div>
    <p v-if="error" class="text-red-600">{{ error }}</p>
  </div>
</template>
