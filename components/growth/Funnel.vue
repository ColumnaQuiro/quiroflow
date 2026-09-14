<script setup lang="ts">
import type { GrowthFunnelStage, GrowthFunnelStep } from '~/composables/useGrowthDashboard'

const props = defineProps<{
  stages: GrowthFunnelStage[]
  steps: GrowthFunnelStep[]
  endToEndRate: string
  /** Absent when the funnel is too empty to name a worst step. */
  dropOff: { summary: string; action: string } | null
}>()

const t = useT()

// Indigo stepping lighter down the funnel, as alpha over the card rather
// than five hardcoded hexes -- brand is a theme variable, so this is the
// only version of the ramp that survives the dark palette.
const SHADE = ['bg-brand', 'bg-brand/85', 'bg-brand/[.65]', 'bg-brand/[.48]', 'bg-brand/[.26]']

const MAX_BAR = 74
const MIN_BAR = 18

// Bar length is proportional to the count, floored so the last stage stays
// visible. The design's own bars are compressed at the tail (a 96 next to a
// 412 drawn about a third as tall rather than a quarter); read as a chart
// that flatters the worst number, which is the one number here that most
// needs to look as bad as it is.
const bars = computed(() => {
  const max = Math.max(...props.stages.map((s) => s.count), 1)
  return props.stages.map((s) => Math.max(MIN_BAR, Math.round((s.count / max) * MAX_BAR)))
})

const RATE_TONE: Record<GrowthFunnelStep['tone'], string> = {
  neutral: 'text-brand-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
}
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4 shadow-card sm:px-[18px]">
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">
        {{ t('Acquisition funnel', 'Embudo de captación') }}
      </h2>
      <p class="text-right text-[11px] text-ink-faint">
        {{ t('Stranger to care plan', 'De desconocido a plan de tratamiento') }} · {{ endToEndRate }}
        {{ t('end to end', 'de principio a fin') }}
      </p>
    </div>

    <!-- Scrolls rather than wraps: the stage-gap-stage rhythm is what makes
    it a funnel, and a wrapped row of stages is just five numbers. -->
    <div class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div class="flex min-w-[620px] items-stretch">
        <template v-for="(stage, i) in stages" :key="stage.key">
          <div v-if="i > 0" class="flex w-[52px] shrink-0 flex-col items-center justify-center gap-1 pt-[18px] lg:w-[92px]">
            <span class="text-[12px] font-semibold" :class="RATE_TONE[steps[i - 1]!.tone]">{{ steps[i - 1]!.pct }}%</span>
            <span
              class="whitespace-nowrap text-[9.5px]"
              :class="
                steps[i - 1]!.emphasis
                  ? 'rounded-pill border border-danger-border bg-danger-bg px-1.5 py-px text-danger-text'
                  : 'text-ink-faint'
              "
            >{{ steps[i - 1]!.delta }}</span>
          </div>

          <div class="flex flex-1 flex-col gap-2" :data-test="`funnel-stage-${stage.key}`">
            <span class="text-[11px] text-ink-muted">{{ stage.label }}</span>
            <span class="text-[22px] font-semibold leading-none tracking-tightTitle text-ink-900">{{ stage.count }}</span>
            <div class="rounded-ctl" :class="SHADE[i]" :style="{ height: `${bars[i]}px` }" />
            <span v-if="stage.caption" class="text-[10.5px] text-ink-faint">{{ stage.caption }}</span>
          </div>
        </template>
      </div>
    </div>

    <div v-if="dropOff" class="mt-4 flex flex-col gap-2 rounded-ctl border border-danger-border bg-danger-bg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-[11.5px] text-danger-text">{{ dropOff.summary }}</p>
      <!-- The design points this at the AI receptionist's booking rules,
      which do not have a page yet. Left as plain text rather than a link
      that 404s; it becomes a NuxtLink to /growth/receptionist when that
      screen lands. -->
      <span class="shrink-0 whitespace-nowrap text-[11.5px] font-semibold text-danger-text">{{ dropOff.action }}</span>
    </div>
  </section>
</template>
