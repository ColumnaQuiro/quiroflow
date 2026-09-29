<script setup lang="ts">
import { formatEur } from '~/utils/billing'
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

// Worked out in the database by dashboard_bono_debtors, which is
// utils/bonoOwed's bonoOwedCents clause for clause -- the same answer as the
// Debtors report and the patient's Billing tab (see utils/bonoOwed for why a
// bono sold here and one migrated from PracticeHub record their debt
// differently). The widget used to read every bono, every payment on one and
// every Stripe schedule to show five names; now only those five come back,
// with the count and total across all of them.
const SHOWN = 5

interface DebtorRow { package_purchase_id: string; first_name: string | null; last_name: string | null; owed_cents: number }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const debtors = ref<DebtorRow[]>([])
const debtorCount = ref(0)
const totalOwed = ref(0)

onMounted(async () => {
  const { data, error } = await supabase.rpc('dashboard_bono_debtors', { p_limit: SHOWN })
  if (error) throw error
  debtors.value = data ?? []
  debtorCount.value = data?.[0]?.debtor_count ?? 0
  totalOwed.value = data?.[0]?.total_owed_cents ?? 0
  loading.value = false
})

// A bono whose patient this person cannot see comes back without a name.
function patientName(p: DebtorRow) {
  return p.first_name !== null ? `${p.first_name} ${p.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function euros(cents: number) {
  return `${formatEur(cents)}`
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
    <p v-if="debtorCount === 0" class="text-[13px] text-ink-faint">{{ t('No outstanding balances.', 'No hay saldos pendientes.') }}</p>
    <template v-else>
      <ul class="divide-y divide-line-row2">
        <li v-for="p in debtors" :key="p.package_purchase_id" class="flex items-center gap-2 py-1.5 text-[13px] first:pt-0">
          <span class="min-w-0 flex-1 truncate text-ink-700">{{ patientName(p) }}</span>
          <span class="shrink-0 font-mono text-[12.5px] text-danger-text">{{ euros(p.owed_cents) }}</span>
        </li>
      </ul>
      <p class="mt-1.5 border-t border-line-row2 pt-1.5 text-[11.5px] text-ink-muted2">{{ t(`${debtorCount} outstanding · ${euros(totalOwed)} total`, `${debtorCount} pendientes · ${euros(totalOwed)} en total`) }}</p>
    </template>
  </div>
</template>
