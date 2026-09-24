<script setup lang="ts">
// Fill-mode half of a `drawable_image` block: the diagram the clinic uploaded
// (DocImagePicker) with a transparent canvas over it, so the patient can mark
// a body chart where it hurts.
//
// What is stored in DocField.value is the canvas alone -- a transparent PNG
// of the marks, never the diagram flattened into them. Three reasons: it
// keeps the inline payload in patient_docs.fields to the size of a few
// strokes instead of a photograph, it lets the diagram be re-rendered crisply
// at whatever width the screen is, and it means a completed document still
// shows *what* was drawn even if the two are ever pulled apart.
const props = defineProps<{ modelValue: string | null | undefined; imagePath: string | null | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const supabase = useSupabaseClient()
const t = useT()

const canvasRef = ref<HTMLCanvasElement>()
const activePointerId = ref<number | null>(null)
// Whether the canvas is currently holding anything -- drawn here, or painted
// back from a value that arrived already saved. fit() only bothers preserving
// pixels when it is true.
const painted = ref(false)
const hasInk = computed(() => painted.value || !!props.modelValue)

const imageUrl = computed(() => (props.imagePath ? supabase.storage.from('doc-images').getPublicUrl(props.imagePath).data.publicUrl : null))

function context() {
  return canvasRef.value?.getContext('2d') ?? null
}

// As in SignaturePad: a canvas's width/height attributes are its drawing
// buffer, not its rendered size, and the two disagreeing is what puts ink
// somewhere other than under the finger. Assigning either also wipes the
// buffer, hence the copy-and-repaint.
function fit() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  // Capped at 2 rather than the 3 a signature uses. This canvas covers a
  // whole diagram instead of a 120px strip and its PNG is posted inline in
  // patient_docs.fields, so a third device pixel would more than double what
  // is stored for marks that are already legible at two.
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.round(rect.width * ratio)
  const height = Math.round(rect.height * ratio)
  if (canvas.width === width && canvas.height === height) return

  let ink: HTMLCanvasElement | null = null
  if (painted.value && canvas.width > 0 && canvas.height > 0) {
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
  // Repainted stretched to the new box rather than pinned at its old pixel
  // size. The diagram underneath is `w-full`, so it reflows when the box
  // does -- a mark that didn't reflow with it would slide off the shoulder
  // it was put on. That box changes for ordinary reasons on a phone: the
  // diagram finishing loading, a rotation, the URL bar collapsing.
  if (ink) ctx.drawImage(ink, 0, 0, rect.width, rect.height)
  seed()
}

// A drawing that arrived already saved is painted back onto the canvas rather
// than shown as a picture of itself. The signature pad's read-only preview
// exists because a signature is finished when it is emitted; a pain map is
// not -- reopening a form to add the second place it hurts has to work, and
// the practitioner reviewing it in the patient's Documents tab is looking at
// this same component.
//
// Sticky once attempted: the block is keyed by field id, so a different
// document is a different component instance rather than a new value here.
let seeded = false
function seed() {
  const value = props.modelValue
  if (seeded || !value) return
  seeded = true
  const image = new Image()
  image.onload = () => {
    const canvas = canvasRef.value
    const ctx = context()
    if (!canvas || !ctx) return
    // Re-read the box: the diagram may well have finished loading and grown
    // it while this decoded.
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    ctx.drawImage(image, 0, 0, rect.width, rect.height)
    painted.value = true
  }
  image.src = value
}

let resizeObserver: ResizeObserver | undefined

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

// A field the parent resets has to lose its marks too, or the canvas keeps
// showing a drawing the form no longer holds.
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
  // A second finger, or a palm resting on the diagram, would otherwise open
  // its own stroke and drag a line across the middle of it.
  if (activePointerId.value !== null) return
  const ctx = context()
  if (!ctx) return
  activePointerId.value = e.pointerId
  painted.value = true
  try {
    canvasRef.value?.setPointerCapture(e.pointerId)
  } catch {
    // Not fatal -- leave() falls back to ending the stroke at the edge.
  }
  const { x, y } = pointerPos(e)
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Red, not the signature's near-black. These marks sit on a diagram whose
  // own lines are dark, and a mark that can't be told from the drawing under
  // it answers nothing.
  ctx.strokeStyle = '#dc2626'
  ctx.beginPath()
  ctx.moveTo(x, y)
  // A tap that never moves is a legitimate answer -- "it hurts here" is one
  // point, not a scribble -- and moveTo alone draws nothing. With a round
  // cap, a zero-length line is the dot the finger meant.
  ctx.lineTo(x, y)
  ctx.stroke()
}

function move(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value) return
  const ctx = context()
  if (!ctx) return
  const { x, y } = pointerPos(e)
  ctx.lineTo(x, y)
  ctx.stroke()
}

// pointercancel is the one Android fires when the system takes the gesture
// over -- an edge swipe, the notification shade, a second finger -- and
// without it the stroke stays open for ever, picked up again by the next
// move as one long line across the diagram.
function end(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value) return
  activePointerId.value = null
  emit('update:modelValue', canvasRef.value?.toDataURL('image/png') ?? null)
}

function leave(e: PointerEvent) {
  // While we hold the capture the browser keeps delivering this stroke, so
  // leaving the box is not the end of it. Only the un-captured case (a mouse
  // dragged out) ends here.
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
  painted.value = false
  activePointerId.value = null
}

function clear() {
  wipe()
  emit('update:modelValue', null)
}
</script>

<template>
  <div>
    <!-- min-h is what keeps the canvas drawable before the diagram has
         loaded, and at all if the object behind imagePath has gone: the box
         takes its height from the <img>, and a box of zero height gets no
         drawing buffer from fit() and never recovers. -->
    <div class="relative min-h-[200px] overflow-hidden rounded-md border border-gray-300 bg-white">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="t('Diagram to draw on', 'Diagrama para dibujar')"
        class="pointer-events-none block w-full select-none"
        draggable="false"
      />
      <canvas
        ref="canvasRef"
        class="absolute inset-0 h-full w-full touch-none"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @pointerleave="leave"
      ></canvas>
    </div>
    <button type="button" class="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="clear">
      {{ hasInk ? t('Clear drawing', 'Borrar dibujo') : t('Clear', 'Borrar') }}
    </button>
  </div>
</template>
