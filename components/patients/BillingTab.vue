<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
}

const supabase = useSupabaseClient()
const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  invoices.value = data ?? []
  loading.value = false
})

const statusClass: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  unpaid: 'bg-red-50 text-red-700',
  void: 'bg-gray-100 text-gray-500',
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="invoices.length === 0" class="p-8 text-center text-sm text-gray-400">
      No invoices yet.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
        <tr>
          <th class="px-4 py-2">Date</th>
          <th class="px-4 py-2">Invoice #</th>
          <th class="px-4 py-2">Total</th>
          <th class="px-4 py-2">Status</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="invoice in invoices" :key="invoice.id">
          <td class="px-4 py-2.5 text-gray-900">{{ new Date(invoice.created_at).toLocaleDateString() }}</td>
          <td class="px-4 py-2.5 text-gray-500">{{ invoice.invoice_number }}</td>
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
</template>
