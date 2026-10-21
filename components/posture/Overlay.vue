<script setup lang="ts">
import { POINT_LABELS, VIEW_POINTS, type Points, type PostureView, type Pt } from '../../utils/posture'

// One posture photo with what is measured on it: the vertical from the
// ankle (or between the ankles), the points, and the lines between them. In
// the capture screen the points can be dragged (mouse, finger or pencil);
// everywhere else it only shows. Drawn in the photo's own pixels, so the
// points sit where they were placed at any size. Shared with mobile/.
const props = withDefaults(
  defineProps<{
    src: string
    width: number
    height: number
    view: PostureView
    points: Points
    editable?: boolean
    labels?: boolean
  }>(),
  { editable: false, labels: true },
)
const emit = defineEmits<{ 'update:points': [Points] }>()

// What is drawn: the photo and its points, swapped together. An SVG <image>
// paints only once its file has loaded and decoded, the points at once, so
// switching from one view to another showed the new points over the old photo
// for a moment. So a new photo is decoded first, and until it is the previous
// photo stays up with its own points; then both change in the same frame.
// While the photo is the same, the points follow the props live (dragging).
interface Frame { src: string; width: number; height: number; view: PostureView; points: Points }
const settled = shallowRef<Frame | null>(null)
watch(
  () => props.src,
  async (src) => {
    const img = new Image()
    img.src = src
    // A photo that will not decode (an expired link) still gets its points.
    await img.decode().catch(() => {})
    if (props.src === src) settled.value = { src, width: props.width, height: props.height, view: props.view, points: props.points }
  },
  { immediate: true },
)
const f = computed<Frame | null>(() =>
  settled.value?.src === props.src ? { src: props.src, width: props.width, height: props.height, view: props.view, points: props.points } : settled.value,
)

const svg = ref<SVGSVGElement | null>(null)
const paired = computed(() => f.value?.view === 'front' || f.value?.view === 'back')
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const plumbX = computed(() => (!f.value ? 0 : paired.value ? mid(f.value.points.ankleR!, f.value.points.ankleL!)[0] : f.value.points.ankle![0]))
const chain = computed(() => {
  const p = f.value?.points
  if (!p) return ''
  if (!paired.value) return ['ear', 'shoulder', 'hip', 'knee', 'ankle'].map((k) => p[k]!.join(',')).join(' ')
  return ['ear', 'shoulder', 'hip', 'knee', 'ankle'].map((k) => mid(p[`${k}R`]!, p[`${k}L`]!).join(',')).join(' ')
})
const pairs = computed(() => (paired.value && f.value ? ['ear', 'shoulder', 'hip', 'knee', 'ankle'].map((k) => [f.value!.points[`${k}R`]!, f.value!.points[`${k}L`]!] as [Pt, Pt]) : []))
const drawnWidth = computed(() => f.value?.width ?? props.width)
const stroke = computed(() => Math.max(2, Math.round(drawnWidth.value / 300)))
const radius = computed(() => Math.max(6, Math.round(drawnWidth.value / 90)))
const fontSize = computed(() => Math.max(14, Math.round(drawnWidth.value / 55)))

// Dragging: pointer position → photo pixels through the SVG's own transform.
const dragging = ref<string | null>(null)
function toPhoto(e: PointerEvent): Pt | null {
  const el = svg.value
  const ctm = el?.getScreenCTM()
  if (!el || !ctm) return null
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
  return [Math.round(Math.max(0, Math.min(props.width, p.x))), Math.round(Math.max(0, Math.min(props.height, p.y)))]
}
function down(name: string, e: PointerEvent) {
  // Not while the previous photo is still up: its points are not these.
  if (!props.editable || settled.value?.src !== props.src) return
  dragging.value = name
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
}
function move(e: PointerEvent) {
  if (!dragging.value) return
  const at = toPhoto(e)
  if (at) emit('update:points', { ...props.points, [dragging.value]: at })
}
function up() {
  dragging.value = null
}
</script>

<template>
  <svg
    ref="svg"
    :viewBox="`0 0 ${f?.width ?? width} ${f?.height ?? height}`"
    class="block h-auto w-full select-none rounded-card bg-ink-900"
    :class="editable ? 'touch-none' : ''"
    role="img"
    :aria-label="`Foto de postura (${view}) con la vertical y los puntos medidos`"
    data-cy="posture-overlay"
    :data-shown="f?.src === src ? 'true' : undefined"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <template v-if="f">
      <image :href="f.src" x="0" y="0" :width="f.width" :height="f.height" preserveAspectRatio="none" />
      <line :x1="plumbX" y1="0" :x2="plumbX" :y2="f.height" stroke="#7CC4FF" :stroke-width="stroke" :stroke-dasharray="`${stroke * 5} ${stroke * 4}`" />
      <line v-for="(p, i) in pairs" :key="i" :x1="p[0][0]" :y1="p[0][1]" :x2="p[1][0]" :y2="p[1][1]" stroke="#FFB020" :stroke-width="stroke" />
      <polyline :points="chain" fill="none" stroke="#FFB020" :stroke-width="stroke" stroke-linejoin="round" />
      <g v-for="name in VIEW_POINTS[f.view]" :key="name">
        <circle
          :cx="f.points[name]![0]"
          :cy="f.points[name]![1]"
          :r="editable ? radius * 1.6 : radius"
          fill="#FFB020"
          stroke="#fff"
          :stroke-width="stroke"
          :class="editable ? 'cursor-grab' : ''"
          :data-cy="`posture-point-${name}`"
          @pointerdown.prevent="down(name, $event)"
        />
        <text v-if="labels" :x="f.points[name]![0] + radius * 2.2" :y="f.points[name]![1] + fontSize / 3" :font-size="fontSize" font-weight="600" fill="#fff" stroke="rgba(0,0,0,.55)" :stroke-width="fontSize / 6" paint-order="stroke">{{ POINT_LABELS[name] }}</text>
      </g>
    </template>
  </svg>
</template>
