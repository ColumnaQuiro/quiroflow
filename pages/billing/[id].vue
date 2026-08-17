<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const invoiceId = route.params.id as string

interface InvoiceWithPatient extends Tables<'invoices'> {
  patients: { first_name: string; last_name: string | null; email: string | null } | null
}

const invoice = ref<InvoiceWithPatient | null>(null)
const lineItems = ref<Tables<'invoice_line_items'>[]>([])
const payments = ref<Tables<'payments'>[]>([])
const loading = ref(true)
const notFound = ref(false)

const paymentAmount = ref('')
const paymentMethod = ref<'card' | 'cash' | 'other'>('card')
const savingPayment = ref(false)
const error = ref('')
const sending = ref(false)
const sendMessage = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('invoices')
    .select('*, patients(first_name, last_name, email)')
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

const statusClass: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  unpaid: 'bg-red-50 text-red-700',
  void: 'bg-gray-100 text-gray-500',
}

async function recordPayment() {
  error.value = ''
  const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  savingPayment.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: invoiceId,
    amount_cents: amountCents,
    method: paymentMethod.value,
  })

  const newPaid = paidCents.value + amountCents
  if (newPaid >= (invoice.value?.total_cents ?? 0)) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
  }

  savingPayment.value = false
  await load()
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
    await $fetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' })
    sendMessage.value = 'Invoice emailed.'
  } catch (e: any) {
    sendMessage.value = e?.data?.message ?? 'Failed to send email.'
  }
  sending.value = false
}

function printInvoice() {
  window.print()
}
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else-if="notFound" class="text-sm text-gray-400">Invoice not found.</div>
  <div v-else-if="invoice" class="max-w-2xl">
    <div class="flex items-start justify-between print:hidden">
      <h1 class="text-xl font-semibold text-gray-900">Invoice {{ invoice.invoice_number }}</h1>
      <NuxtLink to="/billing" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Billing</NuxtLink>
    </div>

    <div class="mt-4 flex flex-wrap gap-2 print:hidden">
      <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50" @click="printInvoice">
        Print
      </button>
      <button
        type="button"
        :disabled="sending || !invoice.patients?.email"
        class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        @click="sendEmail"
      >
        {{ sending ? 'Sending…' : 'Send via Email' }}
      </button>
      <button
        v-if="invoice.status !== 'void'"
        type="button"
        class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        @click="voidInvoice"
      >
        Void
      </button>
      <span v-if="sendMessage" class="self-center text-sm text-gray-500">{{ sendMessage }}</span>
    </div>
    <p v-if="!invoice.patients?.email" class="mt-1 text-xs text-gray-400 print:hidden">
      Add an email address to this patient to enable sending.
    </p>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-6">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-semibold text-gray-900">{{ store.accountName }}</p>
          <p class="mt-4 text-sm text-gray-500">Invoice to</p>
          <p class="font-medium text-gray-900">{{ invoice.patients?.first_name }} {{ invoice.patients?.last_name }}</p>
        </div>
        <div class="text-right text-sm">
          <p class="text-gray-500">Invoice #{{ invoice.invoice_number }}</p>
          <p class="text-gray-500">{{ new Date(invoice.created_at).toLocaleDateString() }}</p>
          <span class="mt-2 inline-block rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[invoice.status]">
            {{ invoice.status }}
          </span>
        </div>
      </div>

      <table class="mt-6 w-full text-sm">
        <thead class="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="py-2">Description</th>
            <th class="py-2 text-right">Qty</th>
            <th class="py-2 text-right">Price</th>
            <th class="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="line in lineItems" :key="line.id">
            <td class="py-2 text-gray-900">{{ line.description }}</td>
            <td class="py-2 text-right text-gray-500">{{ line.quantity }}</td>
            <td class="py-2 text-right text-gray-500">€{{ (line.price_cents / 100).toFixed(2) }}</td>
            <td class="py-2 text-right text-gray-900">€{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="mt-4 space-y-1 border-t border-gray-100 pt-4 text-right text-sm">
        <p class="text-gray-500">Subtotal: €{{ (invoice.total_cents / 100).toFixed(2) }}</p>
        <p class="text-gray-500">Paid to date: €{{ (paidCents / 100).toFixed(2) }}</p>
        <p class="font-semibold text-gray-900">Balance due: €{{ (balanceDueCents / 100).toFixed(2) }}</p>
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-6 print:hidden">
      <h2 class="text-sm font-semibold text-gray-900">Payments</h2>
      <ul v-if="payments.length > 0" class="mt-2 space-y-1 text-sm">
        <li v-for="p in payments" :key="p.id" class="flex justify-between">
          <span class="text-gray-500">{{ new Date(p.paid_at).toLocaleString() }} &middot; {{ p.method }}</span>
          <span class="text-gray-900">€{{ (p.amount_cents / 100).toFixed(2) }}</span>
        </li>
      </ul>
      <p v-else class="mt-2 text-sm text-gray-400">No payments recorded.</p>

      <form v-if="invoice.status !== 'void' && balanceDueCents > 0" class="mt-4 flex items-end gap-2" @submit.prevent="recordPayment">
        <div>
          <label class="block text-sm font-medium text-gray-700">Amount (€)</label>
          <input v-model="paymentAmount" type="number" step="0.01" min="0" class="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Method</label>
          <select v-model="paymentMethod" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button type="submit" :disabled="savingPayment" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ savingPayment ? 'Recording…' : 'Record Payment' }}
        </button>
      </form>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
