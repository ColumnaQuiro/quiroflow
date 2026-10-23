<script setup lang="ts">
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import { AGE_BUCKETS, ageBucketLabel, agedOutstanding, thirdPartyKindLabel, type AgedTotals } from '~/utils/thirdParties'

// What each third party owes the clinic, aged by the date of the visit
// (20261023093754). This is the insurers' debt, kept apart from patients':
// none of it is on a patient's invoices, so the Debtors report and every
// patient balance leave it out by construction.

const supabase = useSupabaseClient()
const t = useT()

interface ChargeRow {
  id: string
  third_party_id: string
  amount_cents: number
  status: string
  service_date: string
  allocations: { amount_cents: number }[]
}

const loading = ref(true)
const loadError = ref('')
const thirdParties = ref<{ id: string; name: string; kind: string; active: boolean }[]>([])
const charges = ref<ChargeRow[]>([])

onMounted(async () => {
  try {
    const [{ data: tps }, rows] = await Promise.all([
      supabase.from('third_parties').select('id, name, kind, active').order('name'),
      fetchAllRows<ChargeRow>(
        (from, to) =>
          supabase
            .from('third_party_charges')
            .select('id, third_party_id, amount_cents, status, service_date, allocations:third_party_payment_allocations(amount_cents)')
            .eq('status', 'pending')
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: ChargeRow[] | null; error: unknown }>,
      ),
    ])
    thirdParties.value = tps ?? []
    charges.value = rows
  } catch (e: any) {
    loadError.value = e?.message ?? String(e)
  }
  loading.value = false
})

const today = new Date().toISOString().slice(0, 10)

const rows = computed(() =>
  thirdParties.value
    .map((tp) => ({ ...tp, aged: agedOutstanding(charges.value.filter((c) => c.third_party_id === tp.id), today) }))
    .filter((r) => r.active || r.aged.total > 0)
    .sort((a, b) => b.aged.total - a.aged.total || a.name.localeCompare(b.name)),
)
const totals = computed<AgedTotals>(() => agedOutstanding(charges.value, today))
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Third parties', 'Terceros')" :meta="t('What insurers, mutuas and companies owe', 'Lo que deben aseguradoras, mutuas y empresas')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/billing" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Billing', 'Facturación') }}</NuxtLink>
        <UiBtn @click="navigateTo('/settings/third-parties')">{{ t('Manage', 'Gestionar') }}</UiBtn>
      </div>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="tp-aged" :data-ready="loading ? undefined : 'true'">
      <p v-if="loadError" class="text-[13px] text-danger-text">{{ loadError }}</p>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="tp-aged-total">{{ loading ? '—' : formatEur(totals.total) }}</p>
        <p class="text-[12px] text-ink-muted2">{{ t('Owed by third parties, not by patients', 'Pendiente de terceros, no de pacientes') }}</p>
      </div>

      <div class="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table class="w-full min-w-[640px] text-[13px]">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-4 py-2">{{ t('Third party', 'Tercero') }}</th>
              <th v-for="b in AGE_BUCKETS" :key="b" class="px-4 py-2 text-right">{{ ageBucketLabel(b, t) }}</th>
              <th class="px-4 py-2 text-right">{{ t('Total', 'Total') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <ReportsTableSkeletonRows v-if="loading" :cols="6" />
            <tr v-else-if="rows.length === 0">
              <td colspan="6" class="px-4 py-6 text-center text-ink-faint2">
                {{ t('No third parties yet. Add them under Settings → Third parties.', 'Aún no hay terceros. Añádelos en Ajustes → Terceros.') }}
              </td>
            </tr>
            <tr v-for="r in loading ? [] : rows" :key="r.id" data-cy="tp-aged-row">
              <td class="px-4 py-2.5">
                <NuxtLink :to="`/billing/third-parties/${r.id}`" class="font-medium text-ink-900 hover:text-brand-text" data-cy="tp-aged-name">{{ r.name }}</NuxtLink>
                <span class="ml-1.5 text-[11.5px] text-ink-muted2">{{ thirdPartyKindLabel(r.kind, t) }}</span>
              </td>
              <td v-for="b in AGE_BUCKETS" :key="b" class="px-4 py-2.5 text-right font-mono" :class="r.aged[b] ? 'text-ink-900' : 'text-ink-faint2'">{{ formatEur(r.aged[b]) }}</td>
              <td class="px-4 py-2.5 text-right font-mono font-semibold text-ink-900" data-cy="tp-aged-row-total">{{ formatEur(r.aged.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
