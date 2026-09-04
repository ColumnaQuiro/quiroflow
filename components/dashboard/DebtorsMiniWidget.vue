<script setup lang="ts">
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

interface PurchaseRow {
  id: string
  price_cents: number
  invoice_id: string | null
  patients: { first_name: string; last_name: string | null } | null
}
interface InvoiceRow { id: string; status: string }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())

onMounted(async () => {
  const { data: p } = await supabase.from('package_purchases').select('id, price_cents, invoice_id, patients(first_name, last_name)')
  purchases.value = (p as unknown as PurchaseRow[]) ?? []
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
  purchases.value
    .filter((p) => {
      const schedule = schedulesByPurchase.value.get(p.id)
      if (schedule) return schedule.status === 'past_due'
      const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
      return !inv || inv.status !== 'paid'
    })
    .sort((a, b) => b.price_cents - a.price_cents),
)
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + p.price_cents, 0))

function patientName(p: PurchaseRow) {
  return p.patients ? `${p.patients.first_name} ${p.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 3" :key="i" class="flex items-center gap-2 py-1.5">
      <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
      <UiSkeleton class="ml-auto h-3 w-12 rounded-ctlSm" />
    </div>
  </div>
  <div v-else>
    <p v-if="debtors.length === 0" class="text-[13px] text-ink-faint">{{ t('No outstanding balances.', 'No hay saldos pendientes.') }}</p>
    <template v-else>
      <ul class="divide-y divide-line-row2">
        <li v-for="p in debtors.slice(0, 5)" :key="p.id" class="flex items-center gap-2 py-1.5 text-[13px] first:pt-0">
          <span class="min-w-0 flex-1 truncate text-ink-700">{{ patientName(p) }}</span>
          <span class="shrink-0 font-mono text-[12.5px] text-danger-text">{{ euros(p.price_cents) }}</span>
        </li>
      </ul>
      <p class="mt-1.5 border-t border-line-row2 pt-1.5 text-[11.5px] text-ink-muted2">{{ t(`${debtors.length} outstanding · ${euros(totalOwed)} total`, `${debtors.length} pendientes · ${euros(totalOwed)} en total`) }}</p>
    </template>
  </div>
</template>
