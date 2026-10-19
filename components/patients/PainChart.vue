<script setup lang="ts">
import type { ProgressRow } from '../../composables/usePatientProgress'

// Pain by visit as a curve: one point per scored visit, 0 at the bottom and
// 10 at the top. The web's Progreso tab draws it 720 wide; the staff app
// draws it narrower so its numbers stay readable at phone width.
const props = withDefaults(defineProps<{ visits: ProgressRow[]; width?: number; height?: number; maxLabels?: number }>(), { width: 720, height: 220, maxLabels: 8 })

const t = useT()
const PAD = { l: 34, r: 16, t: 14, b: 30 }
const W = computed(() => props.width)
const H = computed(() => props.height)
const points = computed(() => {
  const n = props.visits.length
  const x = (i: number) => PAD.l + (n <= 1 ? (W.value - PAD.l - PAD.r) / 2 : (i * (W.value - PAD.l - PAD.r)) / (n - 1))
  const y = (v: number) => PAD.t + ((10 - v) * (H.value - PAD.t - PAD.b)) / 10
  return props.visits.map((r, i) => ({ x: x(i), y: y(r.score!), r }))
})
const line = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))
const gridY = computed(() => [0, 2, 4, 6, 8, 10].map((v) => ({ v, y: PAD.t + ((10 - v) * (H.value - PAD.t - PAD.b)) / 10 })))
// Labels under the first, last and every few points between, so they never collide.
const labelEvery = computed(() => Math.max(1, Math.ceil(points.value.length / props.maxLabels)))
const first = computed(() => props.visits[0]?.score ?? null)
const latest = computed(() => props.visits[props.visits.length - 1]?.score ?? null)
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" :aria-label="t(`Pain from ${first} to ${latest} over ${visits.length} visits`, `Dolor de ${first} a ${latest} en ${visits.length} visitas`)" data-cy="progress-chart">
    <g v-for="g in gridY" :key="g.v">
      <line :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y" class="stroke-line" stroke-width="1" />
      <text :x="PAD.l - 8" :y="g.y + 4" text-anchor="end" class="fill-ink-faint font-mono" font-size="11">{{ g.v }}</text>
    </g>
    <polyline v-if="points.length > 1" :points="line" fill="none" class="stroke-brand" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    <g v-for="(p, i) in points" :key="p.r.id">
      <circle :cx="p.x" :cy="p.y" r="4.5" class="fill-surface stroke-brand" stroke-width="2" />
      <text v-if="i === 0 || i === points.length - 1 || i % labelEvery === 0" :x="p.x" :y="H - 8" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ new Date(p.r.startsAt).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) }}</text>
    </g>
  </svg>
</template>
