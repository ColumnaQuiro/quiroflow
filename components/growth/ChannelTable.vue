<script setup lang="ts">
import type { GrowthChannelRow } from '~/composables/useGrowthDashboard'

defineProps<{ rows: GrowthChannelRow[]; totals: GrowthChannelRow }>()

const t = useT()

// en-IE, not es-ES, and not the viewer's language: it renders "€1,480" and
// "€34.10", which is the symbol-first, dot-decimal shape the rest of the app
// hardcodes as `€{{ n.toFixed(2) }}`. es-ES would give "1.480 €" / "34,10 €"
// on a screen sitting next to billing totals that do not move.
const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const euroCents = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

// An em dash, not €0. A referral has no ad spend at all, and a zero would
// put it in the same column of comparison as a channel that spent nothing
// this month but could.
function money(value: number | null, withCents = false) {
  if (value === null) return '—'
  return withCents ? euroCents.format(value) : euro.format(value)
}
</script>

<template>
  <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-[18px]">
      <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Channels', 'Canales') }}</h2>
      <NuxtLink to="/reports" class="shrink-0 text-[11px] font-semibold text-brand-text hover:underline">
        {{ t('Full report', 'Informe completo') }} →
      </NuxtLink>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] border-collapse text-[12px]">
        <thead>
          <tr class="border-b border-line-divider text-[10px] uppercase tracking-[.06em] text-ink-faint">
            <th class="px-4 pb-[7px] text-left font-normal sm:pl-[18px]">{{ t('Channel', 'Canal') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Spend', 'Gasto') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Leads', 'Contactos') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Booked', 'Reservas') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Show', 'Asist.') }}</th>
            <th class="px-4 pb-[7px] text-right font-normal sm:pr-[18px]" :title="t('Cost per new patient', 'Coste por paciente nuevo')">CPNP</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="row.channel"
            class="border-b border-line-divider text-ink-700"
            :class="i % 2 === 1 ? 'bg-surface-subtle' : ''"
          >
            <td class="px-4 py-[9px] sm:pl-[18px]">{{ row.channel }}</td>
            <td class="px-2 py-[9px] text-right" :class="row.spend === null ? 'text-ink-faint' : ''">{{ money(row.spend) }}</td>
            <td class="px-2 py-[9px] text-right">{{ row.leads }}</td>
            <td class="px-2 py-[9px] text-right">{{ row.booked }}</td>
            <td class="px-2 py-[9px] text-right">{{ row.showRate }}%</td>
            <td
              class="px-4 py-[9px] text-right sm:pr-[18px]"
              :class="row.costPerNewPatient === null ? 'text-ink-faint' : 'font-semibold'"
            >{{ money(row.costPerNewPatient, true) }}</td>
          </tr>
          <tr class="bg-chip-bg text-[12px] font-semibold text-ink-900">
            <td class="px-4 py-2.5 sm:pl-[18px]">{{ totals.channel }}</td>
            <td class="px-2 py-2.5 text-right">{{ money(totals.spend) }}</td>
            <td class="px-2 py-2.5 text-right">{{ totals.leads }}</td>
            <td class="px-2 py-2.5 text-right">{{ totals.booked }}</td>
            <td class="px-2 py-2.5 text-right">{{ totals.showRate }}%</td>
            <td class="px-4 py-2.5 text-right sm:pr-[18px]">{{ money(totals.costPerNewPatient, true) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
