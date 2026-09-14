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
        <!-- Hidden until there is an AI receptionist to summarise. The card
        is the tier's headline claim -- "handled 148 conversations, booked
        61" -- and a zeroed version of it would be a claim about a thing that
        does not exist rather than an empty state. -->
        <GrowthAiSummaryCard v-if="data.ai" :ai="data.ai" />
        <GrowthNeedsAttention :alerts="data.alerts" />
      </div>
    </div>

    <div class="grid gap-3 xl:grid-cols-2">
      <GrowthTrendChart :points="data.trend" :axis="data.trendAxis" />
      <GrowthChannelTable :rows="data.channels" :totals="data.channelTotals" />
    </div>
  </div>
</template>
