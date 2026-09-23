<script setup lang="ts">
import { PLAN_COMPARISON, locationsLabel, monthlyLabel, useGrowthCatalogue } from '~/composables/useGrowthPlans'

const t = useT()
const { growth, solo, bundled } = useGrowthCatalogue()

// `current` stays false on all three: which plan the account is on is not
// something this table is told, and marking one as theirs was a guess.
const columns = computed(() => [
  { key: 'solo' as const, name: solo.value?.name ?? 'Solo', price: monthlyLabel(solo.value?.monthly_price_cents), current: false },
  { key: 'clinic' as const, name: bundled.value?.name ?? 'Clinic', price: monthlyLabel(bundled.value?.monthly_price_cents), current: false },
  { key: 'growth' as const, name: 'Your plan + Growth', price: monthlyLabel(growth.value?.monthly_price_cents, '+'), current: false },
])

// Locations come from the plans, so they are the one row that is data rather
// than copy. Growth adds none -- an add-on keeps whatever the plan has.
const rows = computed(() => [
  ...PLAN_COMPARISON,
  {
    feature: 'Locations included',
    note: '',
    solo: locationsLabel(solo.value?.included_clinics),
    clinic: locationsLabel(bundled.value?.included_clinics),
    growth: 'Same as your plan',
  },
])

// "Included" on a row the clinic already pays for should not read as a sales
// point, and "New" should. Everything else is a plain dash.
function cellClass(value: string) {
  if (value === 'New') return 'font-semibold text-brand-text'
  if (value === '—') return 'text-ink-faint'
  return 'text-ink-muted'
}
</script>

<template>
  <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-line-divider px-4 py-4 sm:px-[18px]">
      <div class="flex flex-col gap-1">
        <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">
          {{ t('What changes, and what does not', 'Qué cambia y qué no') }}
        </h2>
        <p class="text-[11.5px] text-ink-muted">
          {{ t(
            'Campaigns and WhatsApp recalls are already in your plan — Growth adds the acquisition layer above them, and Clinic includes it.',
            'Las campañas y los recordatorios por WhatsApp ya están en tu plan: Growth añade la capa de captación por encima, y el plan Clinic lo incluye.',
          ) }}
        </p>
      </div>
      <NuxtLink to="/subscription" class="shrink-0 text-[11.5px] font-semibold text-brand-text hover:underline">
        {{ t('Compare all features', 'Comparar todas las funciones') }} →
      </NuxtLink>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[680px] border-collapse text-[12px]">
        <thead>
          <tr class="border-b border-line-divider">
            <th class="w-[38%] px-4 py-3 text-left sm:pl-[18px]" />
            <th v-for="col in columns" :key="col.key" class="px-3 py-3 text-left align-top">
              <span class="flex flex-col gap-1">
                <span class="flex items-center gap-1.5">
                  <span class="text-[12.5px] font-semibold text-ink-900">{{ col.name }}</span>
                  <span
                    v-if="col.current"
                    class="rounded-pill border border-chip-border bg-chip-bg px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[.06em] text-chip-text"
                  >{{ t('Current', 'Actual') }}</span>
                </span>
                <span class="text-[11px] font-normal text-ink-muted">{{ col.price }}</span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.feature" class="border-b border-line-divider last:border-b-0">
            <td class="px-4 py-2.5 sm:pl-[18px]">
              <span class="flex flex-col gap-0.5">
                <span class="text-[12px] text-ink-700">{{ row.feature }}</span>
                <span v-if="row.note" class="text-[10.5px] text-ink-faint">{{ row.note }}</span>
              </span>
            </td>
            <td v-for="col in columns" :key="col.key" class="px-3 py-2.5 text-[11.5px]" :class="cellClass(row[col.key])">
              {{ row[col.key] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
