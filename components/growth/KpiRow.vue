<script setup lang="ts">
import type { GrowthKpi } from '~/utils/growthDashboard'

defineProps<{ kpis: GrowthKpi[] }>()

// A neutral delta is a caption, not a change, so it gets no pill -- pills
// here mean "this moved", and a bordered chip saying "€20,620 spend" would
// read as movement that did not happen.
const TONE: Record<string, 'success' | 'warning'> = { positive: 'success', negative: 'warning' }
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
    <div
      v-for="kpi in kpis"
      :key="kpi.key"
      class="flex flex-col gap-[7px] rounded-card border border-line bg-surface p-[14px] shadow-card"
    >
      <span class="text-[11px] text-ink-muted">{{ kpi.label }}</span>
      <!-- Ledger figures: mono, so the five values line up as a row of
      entries rather than five differently-wide words. -->
      <span class="font-mono text-[23px] font-semibold leading-none text-ink-900">{{ kpi.value }}</span>
      <UiPill v-if="kpi.tone !== 'neutral'" :tone="TONE[kpi.tone]" class="self-start">{{ kpi.delta }}</UiPill>
      <span v-else class="text-[11px] text-ink-muted">{{ kpi.delta }}</span>
    </div>
  </div>
</template>
