<script setup lang="ts">
const props = defineProps<{ modelValue: string | null | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const t = useT()
const canvasRef = ref<HTMLCanvasElement>()
const hasStroke = ref(false)
const activePointerId = ref<number | null>(null)

// Every finished stroke emits a data URL, so modelValue fills the instant the
// first pen lift happens -- and the <img> preview used to be shown on that
// alone, replacing the canvas mid-signature. A mouse signature is one
// uninterrupted drag and survived that; a finger signature is four or five
// strokes, so on a phone the pad went read-only part-way through a name and
// the rest of it landed on a picture. With clear() broken in exactly that
// state too (see below), there was no way back either. Hence `editing`: the
// preview is for a signature that arrived already saved, never for one being
// drawn here.
const editing = ref(false)
const showSaved = computed(() => !!props.modelValue && !editing.value)
const hasInk = computed(() => hasStroke.value || !!props.modelValue)

function context() {
  return canvasRef.value?.getContext('2d') ?? null
}

// A canvas's width/height attributes set its drawing-buffer resolution,
// separate from whatever size CSS renders it at -- and unlike img/video,
// Tailwind's preflight doesn't constrain canvas to its container width. A
// hardcoded width="400" used to render at a fixed 400px regardless of
// screen size, wider than the ~280-330px available on most Android phones
// once page/card padding is subtracted, forcing the whole page to scroll
// horizontally mid-signature. Sizing the buffer to match the element's
// actual rendered box keeps pointerPos()'s coordinates (computed from that
// same box below) aligned with where ink actually lands, at any width.
//
// Assigning width or height also wipes the buffer and resets the context, so
// this returns early when the size hasn't actually changed, and otherwise
// copies the ink out and paints it back: a phone rotating, or its URL bar
// collapsing as the page scrolls, used to erase a half-drawn signature.
function fit() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  // Backing pixels per CSS pixel. A signature ends up printed in a consent
  // form, so draw it at the device's real resolution instead of at the ~330
  // pixels a phone renders the pad at; the ctx.scale() below keeps every
  // coordinate we hand the context in CSS pixels regardless.
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  const width = Math.round(rect.width * ratio)
  const height = Math.round(rect.height * ratio)
  if (canvas.width === width && canvas.height === height) return

  let ink: HTMLCanvasElement | null = null
  if (hasStroke.value && canvas.width > 0 && canvas.height > 0) {
    ink = document.createElement('canvas')
    ink.width = canvas.width
    ink.height = canvas.height
    ink.getContext('2d')?.drawImage(canvas, 0, 0)
  }

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(ratio, ratio)
  if (ink) ctx.drawImage(ink, 0, 0, rect.width, rect.height)
}

let resizeObserver: ResizeObserver | undefined

// The canvas is behind a v-if, so after a clear it is a *different* element:
// one onMounted stopped caring about long ago, and one the old ResizeObserver
// is no longer watching. Re-fitting it here is what keeps ink under the
// finger on the second signature as well as the first.
watch(
  canvasRef,
  (canvas, previous) => {
    if (previous) resizeObserver?.unobserve(previous)
    if (!canvas) return
    fit()
    resizeObserver ??= new ResizeObserver(fit)
    resizeObserver.observe(canvas)
  },
  { flush: 'post' },
)

// A field the parent resets (loading a different doc into the same pad) has
// to lose its ink too, or the canvas keeps showing a signature the form no
// longer holds.
watch(
  () => props.modelValue,
  (value) => {
    if (!value) wipe()
  },
)

onMounted(fit)
onUnmounted(() => resizeObserver?.disconnect())

function pointerPos(e: PointerEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function start(e: PointerEvent) {
  // A second finger, or a palm resting on the pad, would otherwise open its
  // own stroke and drag a line across the middle of the signature.
  if (activePointerId.value !== null) return
  const ctx = context()
  if (!ctx) return
  activePointerId.value = e.pointerId
  editing.value = true
  hasStroke.value = true
  try {
    // Keeps this stroke's moves coming even once the finger drifts off a pad
    // only 120px tall, which on a phone it constantly does. Throws for a
    // pointer id that isn't actually down (synthetic events in tests).
    canvasRef.value?.setPointerCapture(e.pointerId)
  } catch {
    // Not fatal -- leave() falls back to ending the stroke at the edge.
  }
  const { x, y } = pointerPos(e)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111827'
  ctx.beginPath()
  ctx.moveTo(x, y)
}

function move(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value) return
  const ctx = context()
  if (!ctx) return
  const { x, y } = pointerPos(e)
  ctx.lineTo(x, y)
  ctx.stroke()
}

// pointerup is the ordinary end of a stroke. pointercancel is the one Android
// fires when the system takes the gesture over -- an edge swipe, the
// notification shade, a second finger -- and without it the stroke stayed
// open for ever: never emitted, and picked up again by the next move as one
// long line across the pad.
function end(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value) return
  activePointerId.value = null
  emit('update:modelValue', canvasRef.value?.toDataURL('image/png') ?? null)
}

function leave(e: PointerEvent) {
  // While we hold the capture the browser keeps delivering this stroke, so
  // leaving the pad is not the end of it. Only the un-captured case (a mouse
  // dragged out of the box) ends here.
  if (canvasRef.value?.hasPointerCapture(e.pointerId)) return
  end(e)
}

function wipe() {
  const canvas = canvasRef.value
  const ctx = context()
  if (ctx && canvas) {
    // fit() leaves a device-pixel-ratio scale on the context; clearing in
    // untransformed coordinates covers the whole buffer whatever it is.
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
  hasStroke.value = false
  activePointerId.value = null
}

// The button is on screen in both states, including the one where there is no
// canvas at all because a saved signature is showing as an <img>. Bailing out
// on the missing canvas -- what this used to do -- is why "Borrar firma" did
// nothing precisely when it was the only thing left to press.
function clear() {
  wipe()
  emit('update:modelValue', null)
}
</script>

<template>
  <div>
    <div v-if="showSaved" class="rounded-md border border-gray-300 bg-white p-2">
      <img :src="modelValue ?? ''" :alt="t('Signature', 'Firma')" class="h-24" />
    </div>
    <canvas
      v-else
      ref="canvasRef"
      class="h-[120px] w-full touch-none rounded-md border border-gray-300 bg-white"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
      @pointerleave="leave"
    ></canvas>
    <button type="button" class="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="clear">
      {{ hasInk ? t('Clear signature', 'Borrar firma') : t('Clear', 'Borrar') }}
    </button>
  </div>
</template>
