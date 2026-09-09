<script setup lang="ts">
const props = defineProps<{ modelValue: string | null | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const t = useT()
const canvasRef = ref<HTMLCanvasElement>()
const drawing = ref(false)
const hasStroke = ref(false)

function context() {
  return canvasRef.value?.getContext('2d') ?? null
}

// A canvas's width/height attributes set its drawing-buffer resolution,
// separate from whatever size CSS renders it at -- and unlike img/video,
// Tailwind's preflight doesn't constrain canvas to its container width. A
// hardcoded width="400" used to render at a fixed 400px regardless of
// screen size, wider than the ~280-330px available on most Android phones
// once page/card padding is subtracted, forcing the whole page to scroll
// horizontally mid-signature -- which is what made this hard to sign at
// all rather than just cramped. Sizing the buffer to match the element's
// actual rendered box keeps pointerPos()'s coordinates (computed from that
// same box below) aligned with where ink actually lands, at any width.
function sizeToContainer() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  canvas.width = rect.width
  canvas.height = rect.height
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  sizeToContainer()
  resizeObserver = new ResizeObserver(sizeToContainer)
  if (canvasRef.value) resizeObserver.observe(canvasRef.value)
})
onUnmounted(() => resizeObserver?.disconnect())

function pointerPos(e: PointerEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function start(e: PointerEvent) {
  drawing.value = true
  hasStroke.value = true
  const ctx = context()
  if (!ctx) return
  const { x, y } = pointerPos(e)
  ctx.beginPath()
  ctx.moveTo(x, y)
}

function move(e: PointerEvent) {
  if (!drawing.value) return
  const ctx = context()
  if (!ctx) return
  const { x, y } = pointerPos(e)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#111827'
  ctx.lineTo(x, y)
  ctx.stroke()
}

function end() {
  if (!drawing.value) return
  drawing.value = false
  emit('update:modelValue', canvasRef.value?.toDataURL('image/png') ?? null)
}

function clear() {
  const ctx = context()
  const canvas = canvasRef.value
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  hasStroke.value = false
  emit('update:modelValue', null)
}
</script>

<template>
  <div>
    <div v-if="modelValue" class="rounded-md border border-gray-300 bg-white p-2">
      <img :src="modelValue" :alt="t('Signature', 'Firma')" class="h-24" />
    </div>
    <canvas
      v-else
      ref="canvasRef"
      width="400"
      height="120"
      class="h-[120px] w-full touch-none rounded-md border border-gray-300 bg-white"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="end"
      @pointerleave="end"
    ></canvas>
    <button type="button" class="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="clear">
      {{ modelValue ? t('Clear signature', 'Borrar firma') : t('Clear', 'Borrar') }}
    </button>
  </div>
</template>
