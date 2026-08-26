<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const appointmentId = route.params.id as string

interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  appointment_type_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; default_price_cents: number } | null
}
interface InvoiceRow { id: string; invoice_number: string; status: string; total_cents: number }
interface PaymentRow { id: string; amount_cents: number; method: string; paid_at: string }

const supabase = useSupabaseClient()
const { context } = usePractitionerContext()
const { fire } = useAutomations()

const appointment = ref<Appointment | null>(null)
const invoice = ref<InvoiceRow | null>(null)
const payments = ref<PaymentRow[]>([])
const loading = ref(true)
const billingOpen = ref(false)
const paymentAmount = ref('')
const paymentMethod = ref<'card' | 'cash'>('cash')
const saving = ref(false)
const error = ref('')

const paidCents = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const balanceDueCents = computed(() => (invoice.value?.total_cents ?? 0) - paidCents.value)

async function loadAppointment() {
  const { data } = await supabase
    .from('appointments')
    .select('id, patient_id, starts_at, ends_at, status, checked_in_at, appointment_type_id, patients(first_name, last_name), appointment_types(name, default_price_cents)')
    .eq('id', appointmentId)
    .maybeSingle()
  appointment.value = data as unknown as Appointment
  loading.value = false
}
onMounted(loadAppointment)

async function checkIn() {
  await supabase.from('appointments').update({ checked_in_at: new Date().toISOString() } as never).eq('id', appointmentId)
  await loadAppointment()
}

async function ensureInvoice(): Promise<InvoiceRow | null> {
  const { data: existing } = await supabase.from('invoices').select('id, invoice_number, status, total_cents').eq('appointment_id', appointmentId).maybeSingle()
  if (existing) return existing
  if (!appointment.value || !context.value) return null

  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
  const priceCents = appointment.value.appointment_types?.default_price_cents ?? 0
  const description = appointment.value.appointment_types?.name ?? 'Appointment'

  const { data: newInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      account_id: context.value.accountId,
      patient_id: appointment.value.patient_id,
      appointment_id: appointmentId,
      invoice_number: invoiceNumber,
      status: 'unpaid',
      total_cents: priceCents,
    } as never)
    .select('id, invoice_number, status, total_cents')
    .single()
  if (invoiceError) {
    error.value = invoiceError.message
    return null
  }
  await supabase.from('invoice_line_items').insert({
    account_id: context.value.accountId,
    invoice_id: newInvoice.id,
    description,
    quantity: 1,
    price_cents: priceCents,
  } as never)
  return newInvoice
}

async function openBilling() {
  billingOpen.value = true
  error.value = ''
  const inv = await ensureInvoice()
  invoice.value = inv
  if (inv) {
    const { data: pays } = await supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', inv.id).order('paid_at', { ascending: false })
    payments.value = pays ?? []
    paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  }
}

async function recordPayment() {
  if (!invoice.value || !context.value || !appointment.value) return
  error.value = ''
  const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  saving.value = true
  try {
    await supabase.from('payments').insert({
      account_id: context.value.accountId,
      invoice_id: invoice.value.id,
      amount_cents: amountCents,
      method: paymentMethod.value,
    } as never)

    const newPaid = paidCents.value + amountCents
    if (newPaid >= invoice.value.total_cents) {
      await supabase.from('invoices').update({ status: 'paid' } as never).eq('id', invoice.value.id)
      await supabase.from('appointments').update({ status: 'completed' } as never).eq('id', appointmentId)
      fire('invoice.paid', { patientId: appointment.value.patient_id, appointmentId, invoiceId: invoice.value.id })
      fire('appointment.completed', { patientId: appointment.value.patient_id, appointmentId })
      await loadAppointment()
    }
    const { data: pays } = await supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', invoice.value.id).order('paid_at', { ascending: false })
    payments.value = pays ?? []
    const { data: inv } = await supabase.from('invoices').select('id, invoice_number, status, total_cents').eq('id', invoice.value.id).maybeSingle()
    invoice.value = inv
    paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  } finally {
    saving.value = false
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text" @click="navigateTo('/calendar')">&larr;</button>
      <p class="truncate text-[15px] font-[600] text-ink-900">Appointment</p>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="!appointment" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">Appointment not found.</p>

    <div v-else class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div>
        <p class="text-[17px] font-semibold text-ink-900">{{ appointment.patients?.first_name }} {{ appointment.patients?.last_name ?? '' }}</p>
        <p class="mt-1 text-[13.5px] text-ink-muted2">{{ formatDate(appointment.starts_at) }} · {{ appointment.appointment_types?.name ?? 'Appointment' }}</p>
        <p class="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-faint">{{ appointment.status }}</p>
      </div>

      <NuxtLink :to="`/patients/${appointment.patient_id}`" class="block rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] font-medium text-brand-text shadow-card">
        View patient →
      </NuxtLink>

      <button
        v-if="!appointment.checked_in_at && appointment.status !== 'completed'"
        type="button"
        class="w-full rounded-ctl border border-line-control px-4 py-2.5 text-center text-[14px] font-medium text-brand-text active:bg-surface-subtle"
        @click="checkIn"
      >
        Check in
      </button>

      <div v-if="!billingOpen">
        <button
          type="button"
          class="w-full rounded-ctl bg-brand px-4 py-2.5 text-center text-[14px] font-medium text-white active:opacity-90"
          @click="openBilling"
        >
          Bill this visit
        </button>
      </div>

      <div v-else class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Billing</p>
        <p v-if="!invoice" class="text-[13px] text-ink-faint">Loading invoice…</p>
        <template v-else>
          <p class="text-[13.5px] text-ink-700">{{ invoice.invoice_number }} · <span :class="invoice.status === 'paid' ? 'text-success-text' : 'text-warning-text'">{{ invoice.status }}</span></p>
          <p class="mt-1 text-[13px] text-ink-muted2">Total {{ euros(invoice.total_cents) }} · Paid {{ euros(paidCents) }}</p>

          <div v-if="invoice.status !== 'paid'" class="mt-3 space-y-2">
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
            <div class="flex gap-2">
              <input
                v-model="paymentAmount"
                type="number"
                step="0.01"
                class="w-24 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]"
              />
              <select v-model="paymentMethod" class="flex-1 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
              </select>
            </div>
            <UiBtn variant="primary" class="w-full" :disabled="saving" @click="recordPayment">{{ saving ? 'Saving…' : `Record ${euros(Math.round((parseFloat(paymentAmount) || 0) * 100))}` }}</UiBtn>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
