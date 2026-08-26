<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const invoiceId = route.params.id as string

interface InvoiceWithPatient extends Tables<'invoices'> {
  patients: { first_name: string; last_name: string | null; email: string | null; address: string | null; national_id: string | null } | null
  appointments: { clinic_id: string } | null
}

const invoice = ref<InvoiceWithPatient | null>(null)
const lineItems = ref<Tables<'invoice_line_items'>[]>([])
const payments = ref<Tables<'payments'>[]>([])
const loading = ref(true)
const notFound = ref(false)

const paymentAmount = ref('')
const paymentMethod = ref<'card' | 'cash' | 'other' | 'credit'>('card')
const savingPayment = ref(false)
const error = ref('')
const sending = ref(false)
const sendMessage = ref('')

const { balanceCents, refresh: refreshCreditSummary } = usePatientFinancialSummary(() => invoice.value?.patient_id ?? '')
const { nextAppointmentDate } = useNextAppointment(() => invoice.value?.patient_id ?? '')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('invoices')
    .select('*, patients(first_name, last_name, email, address, national_id), appointments(clinic_id)')
    .eq('id', invoiceId)
    .maybeSingle()

  if (!data) {
    notFound.value = true
    loading.value = false
    return
  }
  invoice.value = data as unknown as InvoiceWithPatient

  const [{ data: lines }, { data: pays }] = await Promise.all([
    supabase.from('invoice_line_items').select('*').eq('invoice_id', invoiceId),
    supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('paid_at', { ascending: false }),
  ])
  lineItems.value = lines ?? []
  payments.value = pays ?? []
  paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  loading.value = false
}
onMounted(load)

const paidCents = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const balanceDueCents = computed(() => (invoice.value?.total_cents ?? 0) - paidCents.value)

// Which clinic issued this invoice, for the fiscal letterhead -- most
// invoices come from an appointment (which has a clinic_id), but a
// package/membership sale invoice doesn't, so this falls back to the
// account's first clinic (accurate for the common single-clinic case;
// a multi-clinic account selling packages would need to record which
// clinic made the sale to do better than this).
const invoiceClinic = computed(() => {
  const clinicId = invoice.value?.appointments?.clinic_id
  return (clinicId && store.clinics.find((c) => c.id === clinicId)) || store.clinics[0] || null
})

const STATUS_TONE: Record<string, 'success' | 'danger' | 'neutral'> = {
  paid: 'success',
  unpaid: 'danger',
  void: 'neutral',
}

async function recordPayment() {
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
    invoice_id: invoiceId,
    amount_cents: amountCents,
    method: paymentMethod.value,
  })
  if (paymentMethod.value === 'credit') {
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: invoice.value!.patient_id,
      amount_cents: -amountCents,
      reason: `Applied to invoice ${invoice.value!.invoice_number}`,
      invoice_id: invoiceId,
      created_by: store.teamMember?.id ?? null,
    })
  }

  const newPaid = paidCents.value + amountCents
  if (newPaid >= (invoice.value?.total_cents ?? 0)) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
  }

  savingPayment.value = false
  await Promise.all([load(), refreshCreditSummary()])
}

// Footer quick action from the design spec -- settles the remaining balance
// in one click by driving the same recordPayment() path a manual full
// payment would take, so status flips to "paid" through the normal logic.
async function markAsPaid() {
  paymentAmount.value = (balanceDueCents.value / 100).toFixed(2)
  await recordPayment()
}

async function voidInvoice() {
  if (!confirm('Void this invoice?')) return
  await supabase.from('invoices').update({ status: 'void' }).eq('id', invoiceId)
  await load()
}

async function sendEmail() {
  sendMessage.value = ''
  sending.value = true
  try {
    await useStaffFetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' })
    sendMessage.value = 'Invoice emailed.'
  } catch (e: any) {
    sendMessage.value = e?.data?.message ?? 'Failed to send email.'
  }
  sending.value = false
}

async function downloadPdf() {
  const blob = await useStaffFetch<Blob>(`/api/invoices/${invoiceId}/pdf`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${invoice.value?.invoice_number ?? 'invoice'}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

function backToBilling() {
  navigateTo(`/billing?highlight=${invoiceId}`)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="print:hidden">
      <PageHeader :title="invoice ? invoice.invoice_number : 'Invoice'" :meta="invoice ? `${invoice.patients?.first_name ?? ''} ${invoice.patients?.last_name ?? ''}`.trim() : undefined">
        <template v-if="invoice">
          <UiBtn v-if="invoice.status !== 'void'" variant="ghost" size="sm" @click="voidInvoice">Void invoice</UiBtn>
          <UiBtn variant="secondary" @click="backToBilling">&larr; Back to billing</UiBtn>
        </template>
      </PageHeader>
    </div>

    <div class="flex-1 overflow-y-auto bg-surface-page p-6">
      <div v-if="loading" class="text-center text-[13px] text-ink-muted2">Loading…</div>
      <div v-else-if="notFound" class="text-center text-[13px] text-ink-muted2">Invoice not found.</div>

      <div v-else-if="invoice" class="mx-auto max-w-[720px] space-y-4">
        <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div v-if="invoiceClinic?.legal_name || invoiceClinic?.tax_id" class="border-b border-line-divider px-6 py-4">
            <p class="text-[13.5px] font-[620] text-ink-900">{{ invoiceClinic.legal_name || invoiceClinic.name }}</p>
            <p v-if="invoiceClinic.address" class="mt-0.5 text-[12px] text-ink-muted2">{{ invoiceClinic.address }}</p>
            <p v-if="invoiceClinic.tax_id" class="mt-0.5 text-[12px] text-ink-muted2">Tax ID: {{ invoiceClinic.tax_id }}</p>
          </div>

          <div class="flex items-start justify-between p-6">
            <div>
              <p class="font-mono text-[13px] text-ink-muted2">{{ invoice.invoice_number }}</p>
              <p class="mt-1 text-[17px] font-[620] text-ink-900">
                {{ invoice.patients?.first_name }} {{ invoice.patients?.last_name }}
              </p>
              <p v-if="invoice.patients?.address" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ invoice.patients.address }}</p>
              <p v-if="invoice.patients?.national_id" class="mt-0.5 text-[12.5px] text-ink-muted2">ID: {{ invoice.patients.national_id }}</p>
              <p class="mt-1 text-[12.5px] text-ink-muted2">Issued {{ formatDate(invoice.created_at) }}</p>
            </div>
            <div class="text-right">
              <p class="font-mono text-[24px] font-semibold text-ink-900">€{{ (invoice.total_cents / 100).toFixed(2) }}</p>
              <div class="mt-1.5 flex justify-end">
                <UiPill :tone="STATUS_TONE[invoice.status] ?? 'neutral'">{{ invoice.status }}</UiPill>
              </div>
            </div>
          </div>

          <div class="px-6">
            <table class="w-full text-[13px]">
              <thead>
                <tr class="text-left text-[10px] font-semibold uppercase tracking-wide text-ink-faint2">
                  <th class="py-[11px]">Item</th>
                  <th class="py-[11px] text-right">Qty</th>
                  <th class="py-[11px] text-right">Price</th>
                  <th class="py-[11px] text-right">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row2 border-t border-line-row2">
                <tr v-for="line in lineItems" :key="line.id">
                  <td class="py-[11px] text-ink-800">{{ line.description }}</td>
                  <td class="py-[11px] text-right text-ink-muted">{{ line.quantity }}</td>
                  <td class="py-[11px] text-right font-mono text-ink-muted">€{{ (line.price_cents / 100).toFixed(2) }}</td>
                  <td class="py-[11px] text-right font-mono text-ink-900">€{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end px-6 pb-6 pt-2">
            <div class="w-48 space-y-1.5 text-[12.5px]">
              <div class="flex justify-between text-ink-muted">
                <span>Subtotal</span>
                <span class="font-mono">€{{ (invoice.total_cents / 100).toFixed(2) }}</span>
              </div>
              <div class="flex justify-between text-ink-muted">
                <span>VAT</span>
                <span class="font-mono">€0.00</span>
              </div>
              <div class="flex justify-between border-t border-line-row2 pt-1.5 text-[14px] font-semibold text-ink-900">
                <span>Total due</span>
                <span class="font-mono">€{{ (balanceDueCents / 100).toFixed(2) }}</span>
              </div>
            </div>
          </div>

          <div class="border-t border-line-divider px-6 py-4">
            <p v-if="invoiceClinic?.invoice_footer_text" class="whitespace-pre-line text-[12px] text-ink-faint2">{{ invoiceClinic.invoice_footer_text }}</p>
            <p class="mt-1.5 text-[12px] text-ink-faint2">Your next visit: {{ nextAppointmentDate ? formatDate(nextAppointmentDate) : '—' }}</p>
          </div>

          <div class="flex items-center justify-between gap-3 border-t border-line bg-surface-subtle2 px-6 py-4 print:hidden">
            <div class="flex flex-wrap items-center gap-2">
              <UiBtn variant="secondary" :disabled="sending || !invoice.patients?.email" @click="sendEmail">
                {{ sending ? 'Sending…' : 'Send by email' }}
              </UiBtn>
              <UiBtn variant="secondary" @click="downloadPdf">Download PDF</UiBtn>
              <span v-if="sendMessage" class="text-[12.5px] text-ink-muted2">{{ sendMessage }}</span>
            </div>
            <UiBtn
              variant="primary"
              :disabled="savingPayment || invoice.status === 'paid' || invoice.status === 'void' || balanceDueCents <= 0"
              @click="markAsPaid"
            >
              {{ savingPayment ? 'Processing…' : 'Mark as paid' }}
            </UiBtn>
          </div>
        </div>
        <p v-if="!invoice.patients?.email" class="text-[12px] text-ink-faint2 print:hidden">
          Add an email address to this patient to enable sending.
        </p>

        <div class="rounded-card border border-line bg-surface p-6 shadow-card print:hidden">
          <h2 class="text-[13px] font-semibold text-ink-900">Payments</h2>
          <ul v-if="payments.length > 0" class="mt-3 space-y-1.5 text-[13px]">
            <li v-for="p in payments" :key="p.id" class="flex justify-between">
              <span class="text-ink-muted">{{ new Date(p.paid_at).toLocaleString() }} &middot; {{ p.method }}</span>
              <span class="font-mono text-ink-900">€{{ (p.amount_cents / 100).toFixed(2) }}</span>
            </li>
          </ul>
          <p v-else class="mt-2 text-[13px] text-ink-muted2">No payments recorded.</p>

          <form v-if="invoice.status !== 'void' && balanceDueCents > 0" class="mt-4 flex items-end gap-2" @submit.prevent="recordPayment">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-500">Amount (€)</label>
              <input
                v-model="paymentAmount"
                type="number"
                step="0.01"
                min="0"
                class="mt-1 w-28 rounded-ctl border border-line-control px-3 py-1.5 font-mono text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-500">Method</label>
              <select v-model="paymentMethod" class="mt-1 rounded-ctl border border-line-control px-3 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
                <option v-if="balanceCents > 0" value="credit">Credit on account (€{{ (balanceCents / 100).toFixed(2) }} available)</option>
              </select>
            </div>
            <button
              type="submit"
              :disabled="savingPayment"
              class="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ savingPayment ? 'Recording…' : 'Record payment' }}
            </button>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
