<script setup lang="ts">
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

interface PurchaseRow { id: string; price_cents: number; invoice_id: string | null }
interface InvoiceRow { id: string; status: string }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const supabase = useSupabaseClient()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())

onMounted(async () => {
  const { data: p } = await supabase.from('package_purchases').select('id, price_cents, invoice_id')
  purchases.value = p ?? []
  const invoiceIds = purchases.value.map((x) => x.invoice_id).filter((x): x is string => !!x)

  const [{ data: invoices }, { data: schedules }] = await Promise.all([
    invoiceIds.length > 0 ? supabase.from('invoices').select('id, status').in('id', invoiceIds) : Promise.resolve({ data: [] as InvoiceRow[] }),
    supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
  ])
  invoicesById.value = new Map((invoices ?? []).map((i) => [i.id, i as InvoiceRow]))
  schedulesByPurchase.value = new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as ScheduleRow]))
  loading.value = false
})

const debtors = computed(() =>
  purchases.value.filter((p) => {
    const schedule = schedulesByPurchase.value.get(p.id)
    if (schedule) return schedule.status === 'past_due'
    const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
    return !inv || inv.status !== 'paid'
  }),
)
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + p.price_cents, 0))
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else>
    <p class="text-2xl font-semibold text-gray-900">€{{ (totalOwed / 100).toFixed(2) }}</p>
    <p class="text-xs text-gray-500">Outstanding across {{ debtors.length }} purchase(s)</p>
  </div>
</template>
