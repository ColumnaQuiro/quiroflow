<script setup lang="ts">
interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  patients: { first_name: string; last_name: string | null } | null
}

const supabase = useSupabaseClient()

const statusFilter = ref<'all' | 'unpaid' | 'paid' | 'void'>('all')
const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, created_at, patients(first_name, last_name)')
    .order('created_at', { ascending: false })
  if (statusFilter.value !== 'all') query = query.eq('status', statusFilter.value)
  const { data } = await query
  invoices.value = (data as unknown as InvoiceRow[]) ?? []
  loading.value = false
}
onMounted(load)
watch(statusFilter, load)

const statusClass: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  unpaid: 'bg-red-50 text-red-700',
  void: 'bg-gray-100 text-gray-500',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Billing</h1>
      <div class="flex gap-2">
        <NuxtLink to="/billing/services" class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Services &amp; Products
        </NuxtLink>
        <NuxtLink to="/billing/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          + Quick Invoice
        </NuxtLink>
      </div>
    </div>

    <div class="mt-4">
      <select
        v-model="statusFilter"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="all">All statuses</option>
        <option value="unpaid">Unpaid</option>
        <option value="paid">Paid</option>
        <option value="void">Void</option>
      </select>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Date</th>
            <th class="px-4 py-2">Invoice #</th>
            <th class="px-4 py-2">Patient</th>
            <th class="px-4 py-2">Total</th>
            <th class="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="invoices.length === 0">
            <td colspan="5" class="px-4 py-6 text-center text-gray-400">No invoices yet.</td>
          </tr>
          <tr
            v-for="invoice in invoices"
            :key="invoice.id"
            class="cursor-pointer hover:bg-gray-50"
            @click="navigateTo(`/billing/${invoice.id}`)"
          >
            <td class="px-4 py-2.5 text-gray-900">{{ new Date(invoice.created_at).toLocaleDateString() }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ invoice.invoice_number }}</td>
            <td class="px-4 py-2.5 text-gray-900">{{ invoice.patients?.first_name }} {{ invoice.patients?.last_name }}</td>
            <td class="px-4 py-2.5 text-gray-900">€{{ (invoice.total_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[invoice.status]">
                {{ invoice.status }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
