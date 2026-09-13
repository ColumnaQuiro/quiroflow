<script setup lang="ts">
import type { GrowthDashboardData } from '~/composables/useGrowthDashboard'

// Its own component because the locked screen renders this same body blurred
// behind the upgrade card. A clinic evaluating Growth should be looking at
// the real thing out of focus, not a separate mock that can drift from it.
defineProps<{ data: GrowthDashboardData }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <GrowthKpiRow :kpis="data.kpis" />

    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <GrowthFunnel
        :stages="data.funnelStages"
        :steps="data.funnelSteps"
        :end-to-end-rate="data.endToEndRate"
        :drop-off="data.dropOff"
      />
      <div class="flex flex-col gap-3">
        <GrowthAiSummaryCard :ai="data.ai" />
        <GrowthNeedsAttention :alerts="data.alerts" />
      </div>
    </div>

    <div class="grid gap-3 xl:grid-cols-2">
      <GrowthTrendChart :points="data.trend" :axis="data.trendAxis" />
      <GrowthChannelTable :rows="data.channels" :totals="data.channelTotals" />
    </div>
  </div>
</template>
