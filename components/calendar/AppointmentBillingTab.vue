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
const t = useT()

const { loading: summaryLoading, balanceCents, activeMembership, activePackages, refresh: refreshSummary } = usePatientFinancialSummary(
  () => props.patientId,
)

interface InvoiceRow { id: string; invoice_number: string; status: string; total_cents: number }
interface LineItemRow { id: string; description: string; quantity: number; price_cents: number; service_id: string | null }
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
    sendResult.value = t('Sent', 'Enviado')
  } catch (e: any) {
    sendResult.value = e?.data?.message ?? t('Failed to send', 'Error al enviar')
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
      supabase.from('invoice_line_items').select('id, description, quantity, price_cents, service_id').eq('invoice_id', inv.id),
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
    .select('id, description, quantity, price_cents, service_id')
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

  // A package-covered visit is worth the bono's own per-session value
  // (total price ÷ total sessions) -- what the patient actually paid per
  // visit when they bought the bono -- not whatever this appointment
  // type's standalone/drop-in price happens to be. ensureInvoice() stamps
  // every new invoice at the standalone price by default (it doesn't yet
  // know a package will cover the visit); correct the visit's own line
  // item here, before totalling, so the invoice itself reads the bono
  // rate too. Only the auto-created visit line item is repriced -- any
  // separately added services/products (the ones with a service_id) are
  // real extra charges on top of the package and keep their own price.
  const perSessionCents = Math.round(pkg.price_cents / pkg.sessions_total)
  const baseLine = lineItems.value.find((l) => !l.service_id)
  if (baseLine && baseLine.price_cents !== perSessionCents) {
    await supabase.from('invoice_line_items').update({ price_cents: perSessionCents }).eq('id', baseLine.id)
    baseLine.price_cents = perSessionCents
    const totalCents = lineItems.value.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
    await supabase.from('invoices').update({ total_cents: totalCents }).eq('id', invoice.value.id)
    invoice.value.total_cents = totalCents
  }

  // A package session spends real credit -- a payment (method 'credit')
  // plus a matching negative account_credits row, same compound pattern as
  // "Credit on account" below. Previously this just flipped the invoice to
  // 'paid' with no payment behind it at all, which silently broke
  // balanceCents (paid never caught up to invoiced) for every
  // package-covered visit.
  const remainingCents = invoice.value.total_cents - paidCents.value
  if (remainingCents > 0) {
    await supabase.from('payments').insert({
      account_id: store.accountId!,
      invoice_id: invoice.value.id,
      amount_cents: remainingCents,
      method: 'credit',
    })
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -remainingCents,
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
    error.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
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
    <div class="rounded-card border border-line bg-surface-subtle p-3">
      <div v-if="summaryLoading" class="text-ink-faint">{{ t('Loading patient summary…', 'Cargando resumen del paciente…') }}</div>
      <div v-else class="space-y-1.5">
        <p class="flex items-center gap-1.5">
          <span class="text-ink-muted2">{{ t('Balance:', 'Saldo:') }}</span>
          <UiBalancePill v-if="balanceCents !== 0" :balance-cents="balanceCents" />
          <span v-else class="font-medium text-ink-700">€0.00</span>
        </p>
        <p v-if="activeMembership">
          <span class="text-ink-muted2">{{ t('Membership:', 'Membresía:') }}</span>
          <span class="ml-1 font-medium text-ink-900">{{ activeMembership.membership_name }}</span>
          <span class="ml-1 rounded-ctlSm bg-success-bg px-1.5 py-0.5 text-xs font-medium text-success-text">{{ t('active', 'activa') }}</span>
        </p>
        <p v-else class="text-ink-faint">{{ t('No active membership', 'Sin membresía activa') }}</p>
        <div v-if="activePackages.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-ink-muted2">{{ t('Packages:', 'Bonos:') }}</span>
          <span
            v-for="p in activePackages"
            :key="p.id"
            class="inline-flex items-center gap-1.5 rounded-ctlSm bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand-text"
          >
            {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="text-ink-faint">{{ t('Loading invoice…', 'Cargando factura…') }}</div>
    <p v-else-if="!invoice && !can('billing_access')" class="text-ink-faint">{{ t('No invoice for this appointment yet.', 'Todavía no hay factura para esta cita.') }}</p>
    <div v-else-if="invoice" class="rounded-card border border-line bg-surface p-3">
      <div class="flex items-center justify-between">
        <NuxtLink :to="`/billing/${invoice.id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ invoice.invoice_number }}</NuxtLink>
        <div class="flex items-center gap-2">
          <span
            class="rounded-ctlSm px-1.5 py-0.5 text-xs font-medium"
            :class="invoice.status === 'paid' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'"
          >
            {{ invoice.status }}
          </span>
          <span v-if="sendResult" class="text-xs text-ink-faint">{{ sendResult }}</span>
          <button
            v-else-if="can('billing_access')"
            type="button"
            class="text-xs font-medium text-brand-text hover:text-brand-hover disabled:opacity-50"
            :disabled="sendingInvoice"
            @click="sendInvoiceEmail"
          >
            {{ sendingInvoice ? t('Sending…', 'Enviando…') : t('Send invoice', 'Enviar factura') }}
          </button>
        </div>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="flex items-center justify-between text-ink-700">
          <span>{{ line.description }} &times;{{ line.quantity }}</span>
          <span class="flex items-center gap-2">
            €{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}
            <button
              v-if="can('billing_access') && invoice.status !== 'paid'"
              type="button"
              class="text-ink-faint hover:text-danger-text"
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
        class="mt-2 w-full rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none"
        @change="addLineItem"
      >
        <option value="" disabled>{{ t('-- Add Service/Product --', '-- Añadir servicio/producto --') }}</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} (€{{ (s.price_cents / 100).toFixed(2) }})</option>
      </select>

      <div class="mt-2 space-y-0.5 border-t border-line-divider pt-2 text-right">
        <p class="text-ink-muted2">{{ t('Total:', 'Total:') }} €{{ (invoice.total_cents / 100).toFixed(2) }}</p>
        <p class="text-ink-muted2">{{ t('Paid:', 'Pagado:') }} €{{ (paidCents / 100).toFixed(2) }}</p>
        <p class="font-semibold text-ink-900">{{ t('Balance due:', 'Saldo pendiente:') }} €{{ (balanceDueCents / 100).toFixed(2) }}</p>
      </div>

      <form
        v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0"
        class="mt-3 flex items-end gap-2 border-t border-line-divider pt-3"
        @submit.prevent="recordPayment"
      >
        <div>
          <label class="block text-xs font-medium text-ink-700">{{ t('Amount (€)', 'Importe (€)') }}</label>
          <input v-model="paymentAmount" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none" />
        </div>
        <div>
          <label class="block text-xs font-medium text-ink-700">{{ t('Method', 'Método') }}</label>
          <select v-model="paymentMethod" class="mt-1 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none">
            <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
            <option value="card">{{ t('Card', 'Tarjeta') }}</option>
            <option v-if="balanceCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (balanceCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
          </select>
        </div>
        <button type="submit" :disabled="savingPayment" class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">
          {{ savingPayment ? t('Processing…', 'Procesando…') : t('Process', 'Procesar') }}
        </button>
      </form>
      <div
        v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2"
      >
        <span class="text-xs text-ink-muted2">{{ t('Or use a package session:', 'O usar una sesión de bono:') }}</span>
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-2 py-1 text-xs font-medium text-brand-text hover:brightness-95"
          @click="usePackageSession(p)"
        >
          {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})
        </button>
      </div>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-xs text-ink-muted2">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; €{{ (p.amount_cents / 100).toFixed(2) }}</li>
      </ul>

      <p v-if="!hasFutureAppointment" class="mt-3 border-t border-line-divider pt-3 text-sm font-medium text-danger-text">
        {{ t('No future appointment — this patient will show up in Recalls automatically.', 'Sin próxima cita: este paciente aparecerá automáticamente en Recordatorios.') }}
      </p>
    </div>
    <p v-if="error" class="text-danger-text">{{ error }}</p>
  </div>
</template>
