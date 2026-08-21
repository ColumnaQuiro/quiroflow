<script setup lang="ts">
interface PurchaseRow {
  id: string
  patient_id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
}
interface InvoiceRow { id: string; status: string; total_cents: number }
interface PatientRow { id: string; first_name: string; last_name: string }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const supabase = useSupabaseClient()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const patientsById = ref<Map<string, PatientRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())

onMounted(async () => {
  const { data: p } = await supabase
    .from('package_purchases')
    .select('id, patient_id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id')
    .order('purchased_at', { ascending: false })
  purchases.value = p ?? []

  const invoiceIds = purchases.value.map((x) => x.invoice_id).filter((x): x is string => !!x)
  const patientIds = [...new Set(purchases.value.map((x) => x.patient_id))]

  const [{ data: invoices }, { data: patients }, { data: schedules }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('invoices').select('id, status, total_cents').in('id', invoiceIds)
      : Promise.resolve({ data: [] as InvoiceRow[] }),
    patientIds.length > 0
      ? supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
      : Promise.resolve({ data: [] as PatientRow[] }),
    supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
  ])
  invoicesById.value = new Map((invoices ?? []).map((i) => [i.id, i as InvoiceRow]))
  patientsById.value = new Map((patients ?? []).map((p2) => [p2.id, p2 as PatientRow]))
  schedulesByPurchase.value = new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as ScheduleRow]))

  loading.value = false
})

// A purchase is unpaid if it has no linked invoice at all and no Stripe
// autopay schedule keeping up with it, or the linked invoice isn't marked
// paid -- either way the clinic is owed the money. An active/completed
// Stripe schedule means it's being (or was) collected automatically; a
// past_due one means a scheduled charge actually failed, which IS a debt.
const debtors = computed(() =>
  purchases.value.filter((p) => {
    const schedule = schedulesByPurchase.value.get(p.id)
    if (schedule) return schedule.status === 'past_due'
    const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
    return !inv || inv.status !== 'paid'
  }),
)

const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + p.price_cents, 0))

function patientName(id: string) {
  const p = patientsById.value.get(id)
  return p ? `${p.first_name} ${p.last_name}` : '—'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Debtors" meta="Package/bono purchases with no paid invoice">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">Includes any Stripe autopay charge that failed.</p>

      <div v-if="loading" class="mt-6 text-[13px] text-ink-faint2">Loading…</div>
      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="font-mono text-[23px] font-semibold text-ink-900">€{{ (totalOwed / 100).toFixed(2) }}</p>
          <p class="text-[12px] text-ink-muted2">Total outstanding across {{ debtors.length }} purchase(s)</p>
        </div>

        <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table class="w-full text-[13px]">
            <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-4 py-2">Patient</th>
                <th class="px-4 py-2">Package</th>
                <th class="px-4 py-2">Purchased</th>
                <th class="px-4 py-2">Amount owed</th>
                <th class="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-row">
              <tr v-if="debtors.length === 0">
                <td colspan="5" class="px-4 py-6 text-center text-ink-faint2">No debtors — everyone's paid up.</td>
              </tr>
              <tr v-for="p in debtors" :key="p.id">
                <td class="px-4 py-2.5 text-ink-900">
                  <NuxtLink :to="`/patients/${p.patient_id}`" class="hover:text-brand-text">{{ patientName(p.patient_id) }}</NuxtLink>
                </td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ p.package_name }}</td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ new Date(p.purchased_at).toLocaleDateString() }}</td>
                <td class="px-4 py-2.5 font-mono text-ink-900">€{{ (p.price_cents / 100).toFixed(2) }}</td>
                <td class="px-4 py-2.5">
                  <span v-if="schedulesByPurchase.get(p.id)" class="rounded-pill bg-danger-bg px-1.5 py-0.5 text-[11px] font-medium text-danger-text">stripe charge failed</span>
                  <span v-else class="rounded-pill px-1.5 py-0.5 text-[11px] font-medium" :class="p.invoice_id ? 'bg-danger-bg text-danger-text' : 'bg-chip-bg text-chip-text'">
                    {{ p.invoice_id ? (invoicesById.get(p.invoice_id)?.status ?? 'unknown') : 'no invoice' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
