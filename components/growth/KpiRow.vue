<script setup lang="ts">
import type { GrowthKpi } from '~/composables/useGrowthDashboard'

defineProps<{ kpis: GrowthKpi[] }>()

// A neutral delta is a caption, not a change, so it gets no pill -- pills
// here mean "this moved", and a bordered chip saying "€20,620 spend" would
// read as movement that did not happen.
const PILL: Record<string, string> = {
  positive: 'rounded-pill border border-success-border bg-success-bg px-[7px] py-0.5 text-success-text',
  negative: 'rounded-pill border border-warning-border bg-warning-bg px-[7px] py-0.5 text-warning-text',
  neutral: 'text-ink-muted',
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
    <div
      v-for="kpi in kpis"
      :key="kpi.key"
      class="flex flex-col gap-[7px] rounded-card border border-line bg-surface p-[14px] shadow-card"
    >
      <span class="text-[11px] text-ink-muted">{{ kpi.label }}</span>
      <span class="text-[25px] font-semibold leading-none tracking-tightTitle text-ink-900">{{ kpi.value }}</span>
      <span class="self-start text-[10.5px]" :class="PILL[kpi.tone]">{{ kpi.delta }}</span>
    </div>
  </div>
</template>
