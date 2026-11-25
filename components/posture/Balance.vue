<script setup lang="ts">
// Where the body's weight falls over the feet, estimated from the points
// (utils/posture.ts postureBalance, utils/squat.ts for a squat): two feet seen
// from above, the patient's right on the right, and a dot -- across from the
// front photo, along from the side one. Either may be missing; the dot then
// sits in the middle of that direction and the words say which is unknown.
// When the clinic weighed the patient on two scales, `scale` carries the
// readings and `rightShare` is the split they give (scaleRightShare); the
// points' own estimate, if there was one, is shown beside it as `estimate`.
// Shared with mobile/.
const props = defineProps<{
  /** % of the weight over the right foot. */
  rightShare: number | null
  /** cm ahead of the reference (ankle, or the middle of the foot in a squat). */
  forwardCm: number | null
  /** What forwardCm is measured from, for the sentence under the drawing. */
  from?: 'ankle' | 'midfoot'
  /** kg on the scale under each foot, when weighed. */
  scale?: { leftKg: number; rightKg: number } | null
  /** % over the right foot estimated from the points, shown beside a scale reading. */
  estimate?: number | null
}>()

const t = useT()
const W = 220
const H = 210
// Feet 80 px apart centre to centre, 150 px long; the ankle a quarter of the
// way up from the heel. A centimetre forward is 150/26 px: an adult foot.
const L = W / 2 - 40
const R = W / 2 + 40
const HEEL = 185
const TOE = 35
const ANKLE = HEEL - (HEEL - TOE) * 0.25
const MIDFOOT = (HEEL + TOE) / 2
const PX_PER_CM = (HEEL - TOE) / 26
const refY = computed(() => (props.from === 'midfoot' ? MIDFOOT : ANKLE))
const dot = computed(() => {
  const x = props.rightShare === null ? W / 2 : L + ((R - L) * props.rightShare) / 100
  const y = props.forwardCm === null ? refY.value : Math.max(TOE + 6, Math.min(HEEL - 6, refY.value - props.forwardCm * PX_PER_CM))
  return { x, y }
})
const num = (n: number) => n.toLocaleString(t('en-GB', 'es-ES'), { maximumFractionDigits: 1 })
const across = computed(() => (props.rightShare === null ? null : t(`${props.rightShare}% right · ${100 - props.rightShare}% left`, `${props.rightShare} % derecha · ${100 - props.rightShare} % izquierda`)))
const kg = computed(() => {
  const s = props.scale
  if (!s) return null
  const [r, l, total] = [num(s.rightKg), num(s.leftKg), num(s.leftKg + s.rightKg)]
  return t(`Scales: ${r} kg right · ${l} kg left (${total} kg)`, `Básculas: ${r} kg derecha · ${l} kg izquierda (${total} kg)`)
})
const estimated = computed(() => (props.scale && props.estimate !== null && props.estimate !== undefined ? t(`The photo estimated ${props.estimate}% right`, `La foto estimaba un ${props.estimate} % a la derecha`) : null))
const source = computed(() => {
  if (!props.scale) return t('Estimated from the points with average body proportions, not measured on a scale.', 'Estimado a partir de los puntos con las proporciones corporales medias; no es una medida con báscula.')
  return props.forwardCm === null
    ? t('Left–right measured on two scales.', 'Derecha–izquierda medido con dos básculas.')
    : t('Left–right measured on two scales; forward–back estimated from the points.', 'Derecha–izquierda medido con dos básculas; delante–detrás, estimado a partir de los puntos.')
})
// Whole sentences rather than "ahead of" + a place: "de" + "el tobillo" is
// "del tobillo" in Spanish, and Portuguese contracts the same way.
const along = computed(() => {
  const f = props.forwardCm
  if (f === null) return null
  const mid = props.from === 'midfoot'
  const n = num(Math.abs(f))
  if (Math.abs(f) < 0.5) return mid ? t('over the middle of the foot', 'sobre el centro del pie') : t('over the ankle', 'sobre el tobillo')
  if (f > 0) return mid ? t(`${n} cm ahead of the middle of the foot`, `${n} cm por delante del centro del pie`) : t(`${n} cm ahead of the ankle`, `${n} cm por delante del tobillo`)
  return mid ? t(`${n} cm behind the middle of the foot`, `${n} cm por detrás del centro del pie`) : t(`${n} cm behind the ankle`, `${n} cm por detrás del tobillo`)
})
// A foot outline, toes up, centred on x.
const foot = (x: number) => `M${x - 14} ${HEEL - 8} C${x - 22} ${HEEL - 60} ${x - 30} ${TOE + 50} ${x - 20} ${TOE + 12} C${x - 12} ${TOE - 6} ${x + 18} ${TOE - 6} ${x + 22} ${TOE + 14} C${x + 26} ${TOE + 50} ${x + 18} ${HEEL - 60} ${x + 14} ${HEEL - 8} C${x + 10} ${HEEL + 6} ${x - 10} ${HEEL + 6} ${x - 14} ${HEEL - 8} Z`
</script>

<template>
  <div class="flex flex-wrap items-center gap-4" data-cy="posture-balance" :data-right="rightShare ?? undefined" :data-forward="forwardCm ?? undefined">
    <svg :viewBox="`0 0 ${W} ${H}`" class="h-[170px] w-auto shrink-0" role="img" :aria-label="[across, along].filter(Boolean).join(' · ') || t('Balance point', 'Punto de equilibrio')">
      <path :d="foot(L)" class="fill-surface-subtle stroke-line-control" stroke-width="1.5" />
      <path :d="foot(R)" class="fill-surface-subtle stroke-line-control" stroke-width="1.5" />
      <line :x1="W / 2" y1="20" :x2="W / 2" :y2="H - 10" class="stroke-line" stroke-dasharray="4 4" />
      <line x1="20" :y1="refY" :x2="W - 20" :y2="refY" class="stroke-line" stroke-dasharray="4 4" />
      <circle :cx="dot.x" :cy="dot.y" r="9" class="fill-brand" fill-opacity="0.9" stroke="#fff" stroke-width="2.5" />
      <text :x="L" y="204" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ t('Left', 'Izq.') }}</text>
      <text :x="R" y="204" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ t('Right', 'Der.') }}</text>
      <text :x="W / 2" y="14" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ t('toes', 'puntas') }}</text>
    </svg>
    <div class="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px] text-ink-700">
      <p v-if="across" class="font-semibold text-ink-900">{{ across }}</p>
      <p v-else class="text-ink-muted">{{ t('Left–right: needs the front or back photo.', 'Derecha–izquierda: hace falta la foto de frente o de espalda.') }}</p>
      <p v-if="kg" data-cy="posture-balance-kg">{{ kg }}</p>
      <p v-if="along">{{ along }}</p>
      <p v-else class="text-ink-muted">{{ t('Forward–back: needs the side photo.', 'Delante–detrás: hace falta la foto de lado.') }}</p>
      <p v-if="estimated" class="text-[12px] text-ink-muted" data-cy="posture-balance-estimate">{{ estimated }}</p>
      <p class="text-[12px] text-ink-muted">{{ source }}</p>
      <slot />
    </div>
  </div>
</template>
