<script setup lang="ts">
import type { GrowthTrendPoint } from '~/composables/useGrowthDashboard'

const props = defineProps<{ points: GrowthTrendPoint[]; axis: string[] }>()

const t = useT()

// Hand-drawn SVG rather than the chart.js used elsewhere in the app: two
// unlabelled polylines with no axes, tooltips or interaction is the whole
// spec, and it renders identically on the server without pulling a canvas
// library into the page for it.
const VIEW_W = 1000
const VIEW_H = 190
const TOP = 20
const BOTTOM = 170

const scaled = computed(() => {
  const max = Math.max(...props.points.flatMap((p) => [p.leads, p.booked]), 1)
  const step = props.points.length > 1 ? VIEW_W / (props.points.length - 1) : 0
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP)
  const line = (pick: (p: GrowthTrendPoint) => number) =>
    props.points.map((p, i) => `${Math.round(i * step)},${y(pick(p)).toFixed(1)}`).join(' ')
  return { leads: line((p) => p.leads), booked: line((p) => p.booked) }
})
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4 shadow-card sm:px-[18px]">
    <div class="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">
        {{ t('Leads vs booked · last 90 days', 'Contactos vs reservas · últimos 90 días') }}
      </h2>
      <div class="flex gap-3.5 text-[10.5px] text-ink-muted">
        <span class="flex items-center gap-[5px]"><span class="h-0.5 w-[9px] bg-brand" />{{ t('Leads', 'Contactos') }}</span>
        <span class="flex items-center gap-[5px]"><span class="h-0.5 w-[9px] bg-ink-faint" />{{ t('Booked', 'Reservas') }}</span>
      </div>
    </div>

    <svg
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      preserveAspectRatio="none"
      class="block h-[186px] w-full"
      role="img"
      :aria-label="t('Leads versus booked appointments over the last 90 days', 'Contactos frente a citas reservadas en los últimos 90 días')"
    >
      <line v-for="y in [20, 70, 120]" :key="y" x1="0" :y1="y" :x2="VIEW_W" :y2="y" class="stroke-line-divider" stroke-width="1" />
      <line x1="0" :y1="BOTTOM" :x2="VIEW_W" :y2="BOTTOM" class="stroke-line" stroke-width="1" />
      <!-- vector-effect keeps the 2px stroke at 2px: preserveAspectRatio
      "none" stretches the 1000-unit viewBox to the card's width, which
      would otherwise scale the line thickness with it. -->
      <polyline :points="scaled.leads" fill="none" class="stroke-brand" stroke-width="2" vector-effect="non-scaling-stroke" />
      <polyline :points="scaled.booked" fill="none" class="stroke-ink-faint" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>

    <div class="mt-1 flex justify-between text-[10px] text-ink-faint">
      <span v-for="label in axis" :key="label">{{ label }}</span>
    </div>
  </section>
</template>
