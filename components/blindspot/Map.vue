<script setup lang="ts">
import { BLIND_SPOT_CENTRE, BLIND_SPOT_REFERENCE, blindSpotSvgPath, seenPoints, blindSpotPointXY, type BlindSpotEye, type BlindSpotPoint } from '../../utils/blindSpot'

// One eye's blind spot on a degree grid, as the patient sees it: the cross
// they looked at, the typical size (dashed), and the outline measured before
// and after the adjustment. 10 px a degree; the temple is to the right for
// the right eye and to the left for the left one.
const props = defineProps<{
  eye: BlindSpotEye
  before?: BlindSpotPoint[] | null
  after?: BlindSpotPoint[] | null
  showBefore?: boolean
  showAfter?: boolean
  label: string
}>()

const K = 10
const FIX_Y = 120
const fixX = computed(() => (props.eye === 'right' ? 20 : 300))
function place([x, y]: [number, number]): [number, number] {
  return props.eye === 'right' ? [fixX.value + x * K, FIX_Y - y * K] : [fixX.value - x * K, FIX_Y - y * K]
}
const ref0 = computed(() => place([BLIND_SPOT_CENTRE.x, BLIND_SPOT_CENTRE.y]))
const beforePath = computed(() => (props.before ? blindSpotSvgPath(props.before, place) : ''))
const afterPath = computed(() => (props.after ? blindSpotSvgPath(props.after, place) : ''))
const afterDots = computed(() => (props.after ? seenPoints(props.after).map((p) => place(blindSpotPointXY(p))) : []))
const ticks = computed(() => [0, 15, 25].map((deg) => ({ deg, x: props.eye === 'right' ? fixX.value + deg * K : fixX.value - deg * K })))
const uid = useId()
</script>

<template>
  <svg viewBox="0 0 320 260" class="block h-auto w-full rounded-ctl border border-line-row bg-surface-subtle" role="img" :aria-label="label">
    <defs>
      <pattern :id="`${uid}-minor`" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" class="stroke-line-row" stroke-width="1" /></pattern>
      <pattern :id="`${uid}-major`" width="50" height="50" :x="eye === 'right' ? 20 : 0" y="20" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" class="stroke-line" stroke-width="1" /></pattern>
    </defs>
    <rect width="320" height="260" :fill="`url(#${uid}-minor)`" />
    <rect width="320" height="260" :fill="`url(#${uid}-major)`" />
    <line x1="0" :y1="FIX_Y" x2="320" :y2="FIX_Y" class="stroke-line-control" stroke-width="1" />
    <ellipse :cx="ref0[0]" :cy="ref0[1]" :rx="BLIND_SPOT_REFERENCE.rx * K" :ry="BLIND_SPOT_REFERENCE.ry * K" fill="none" class="stroke-ink-faint3" stroke-width="1.5" stroke-dasharray="2 3" />
    <path v-if="showBefore !== false && beforePath" :d="beforePath" class="fill-warning-accent/10 stroke-warning-accent" stroke-width="1.5" stroke-dasharray="4 3" data-cy="blind-spot-map-before" />
    <path v-if="showAfter !== false && afterPath" :d="afterPath" class="fill-brand/10 stroke-brand" stroke-width="2" data-cy="blind-spot-map-after" />
    <template v-if="showAfter !== false">
      <circle v-for="(d, i) in afterDots" :key="i" :cx="d[0]" :cy="d[1]" r="2.2" class="fill-brand" />
    </template>
    <path :d="`M${fixX - 6} ${FIX_Y}h12M${fixX} ${FIX_Y - 6}v12`" class="stroke-ink-900" stroke-width="1.5" />
    <text v-for="tk in ticks" :key="tk.deg" :x="tk.x" y="248" text-anchor="middle" class="fill-ink-muted font-mono" font-size="10">{{ tk.deg }}°</text>
  </svg>
</template>
