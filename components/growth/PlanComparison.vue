<script setup lang="ts">
import { PLAN_COMPARISON, locationsLabel, monthlyLabel, useGrowthCatalogue, type PlanCell } from '~/composables/useGrowthPlans'

const t = useT()
const { growth, solo, bundled } = useGrowthCatalogue()

// `current` stays false on all three: which plan the account is on is not
// something this table is told, and marking one as theirs was a guess.
const columns = computed(() => [
  { key: 'solo' as const, name: solo.value?.name ?? 'Solo', price: monthlyLabel(solo.value?.monthly_price_cents, t), current: false },
  { key: 'clinic' as const, name: bundled.value?.name ?? 'Practice', price: monthlyLabel(bundled.value?.monthly_price_cents, t), current: false },
  { key: 'growth' as const, name: t('Your plan + Growth', 'Tu plan + Growth'), price: monthlyLabel(growth.value?.monthly_price_cents, t, '+'), current: false },
])

const CELL: Record<PlanCell, [string, string]> = {
  included: ['Included', 'Incluido'],
  new: ['New', 'Nuevo'],
  none: ['—', '—'],
}

// Every row worded in the reader's language. It was English whatever the
// language, the one table on a Spanish screen that was not.
//
// Locations come from the plans, so they are the one row that is data rather
// than copy. Growth adds none -- an add-on keeps whatever the plan has.
const rows = computed(() => [
  ...PLAN_COMPARISON.map((row) => ({
    feature: t(...row.feature),
    note: row.note ? t(...row.note) : '',
    cells: { solo: row.solo, clinic: row.clinic, growth: row.growth } as Record<'solo' | 'clinic' | 'growth', PlanCell | string>,
  })),
  {
    feature: t('Locations included', 'Centros incluidos'),
    note: '',
    cells: {
      solo: locationsLabel(solo.value?.included_clinics, t),
      clinic: locationsLabel(bundled.value?.included_clinics, t),
      growth: t('Same as your plan', 'Los de tu plan'),
    } as Record<'solo' | 'clinic' | 'growth', PlanCell | string>,
  },
])

function cellText(value: PlanCell | string) {
  return value in CELL ? t(...CELL[value as PlanCell]) : value
}

// "Included" on a row the clinic already pays for should not read as a sales
// point, and "New" should. Everything else is a plain dash.
function cellClass(value: PlanCell | string) {
  if (value === 'new') return 'font-semibold text-brand-text'
  if (value === 'none') return 'text-ink-faint'
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
            'Campaigns and WhatsApp recalls are already in your plan — Growth adds the acquisition layer above them, and Practice and Clinic include it.',
            'Las campañas y los recordatorios por WhatsApp ya están en tu plan: Growth añade la capa de captación por encima, y los planes Practice y Clinic lo incluyen.',
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
                    class="rounded-pill border border-chip-border bg-chip-bg px-1.5 py-px text-[11px] font-[640] uppercase tracking-[.07em] text-chip-text"
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
                <span v-if="row.note" class="text-[11px] text-ink-faint">{{ row.note }}</span>
              </span>
            </td>
            <td v-for="col in columns" :key="col.key" class="px-3 py-2.5 text-[11.5px]" :class="cellClass(row.cells[col.key])">
              {{ cellText(row.cells[col.key]) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
