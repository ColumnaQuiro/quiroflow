<script setup lang="ts">
import { layoutTree, type InsertPoint } from '~/utils/automationLayout'
import { outletLabel, stepDetail, stepEyebrow, stepTitle, triggerDetail } from '~/utils/automationDescribe'
import { say, stepDef, triggerTitle, KIND_LABEL } from '~/utils/automationCatalog'

// The builder's canvas: the automation laid out as a tree
// (utils/automationLayout.ts), a "+" wherever a step can go, and zoom / pan /
// fit. Custom rather than a graph library: the shapes are fixed (a column
// that forks in two), the layout is fifty lines, and a library would bring a
// second rendering model to theme, to make touch-friendly and to test.
//
// Pan by dragging the background (one finger on a tablet); zoom with the
// buttons or Ctrl/Cmd + scroll.

const props = defineProps<{ readOnly?: boolean; popoverMenu?: boolean }>()
const emit = defineEmits<{ insert: [point: InsertPoint] }>()

const b = useBuilder()
const t = useT()

const layout = computed(() => layoutTree(b.draft.value.steps))

const viewport = ref<HTMLElement | null>(null)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.6

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
}
function zoomBy(factor: number, around?: { x: number; y: number }) {
  const el = viewport.value
  const next = clampZoom(zoom.value * factor)
  const cx = around?.x ?? (el ? el.clientWidth / 2 : 0)
  const cy = around?.y ?? (el ? el.clientHeight / 2 : 0)
  // Keep the point under the cursor (or the centre) where it is.
  pan.value = { x: cx - ((cx - pan.value.x) * next) / zoom.value, y: cy - ((cy - pan.value.y) * next) / zoom.value }
  zoom.value = next
}
function fit() {
  const el = viewport.value
  if (!el) return
  const pad = 24
  const z = clampZoom(Math.min(1, (el.clientWidth - pad * 2) / layout.value.width, (el.clientHeight - pad * 2) / layout.value.height))
  zoom.value = z
  pan.value = { x: (el.clientWidth - layout.value.width * z) / 2, y: pad }
}
/**
 * At 100 %, the trigger centred at the top -- how it opens, so the text is
 * readable; a flow wider than the screen is one "Fit" or a drag away.
 */
function home() {
  const el = viewport.value
  if (!el) return
  zoom.value = 1
  const trigger = layout.value.nodes.find((n) => n.kind === 'trigger')
  const cx = trigger ? trigger.x + trigger.w / 2 : layout.value.width / 2
  pan.value = { x: el.clientWidth / 2 - cx, y: 0 }
}
onMounted(() => nextTick(home))
defineExpose({ fit, home })

// ---- panning
let drag: { id: number; x: number; y: number; px: number; py: number; moved: boolean } | null = null
function onPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button, [role="menu"], input, select, textarea')) return
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y, moved: false }
  viewport.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
  pan.value = { x: drag.px + dx, y: drag.py + dy }
}
function onPointerUp(e: PointerEvent) {
  if (drag && drag.id === e.pointerId && !drag.moved && b.selection.value?.kind === 'insert') b.selection.value = null
  drag = null
}
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const rect = viewport.value!.getBoundingClientRect()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    return
  }
  e.preventDefault()
  pan.value = { x: pan.value.x - e.deltaX, y: pan.value.y - e.deltaY }
}

// ---- what each node says
const problemSteps = computed(() => new Set(b.problems.value.map((p) => p.stepId).filter(Boolean)))
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—')

function statsLine(stepId: string, type: string): string {
  const s = b.stats.value.steps[stepId]
  if (!s) return ''
  const parts: string[] = []
  if (type === 'whatsapp_template') {
    if (b.canReadWhatsApp.value) {
      if (s.whatsapp.sent) parts.push(t(`${s.whatsapp.sent} sent · ${pct(s.whatsapp.read, s.whatsapp.sent)} read`, `${s.whatsapp.sent} enviados · ${pct(s.whatsapp.read, s.whatsapp.sent)} leídos`))
      if (s.whatsapp.recorded) parts.push(t(`${s.whatsapp.recorded} recorded (test)`, `${s.whatsapp.recorded} registrados (prueba)`))
      if (s.whatsapp.failed) parts.push(t(`${s.whatsapp.failed} failed`, `${s.whatsapp.failed} fallaron`))
    }
  } else if (type === 'email') {
    if (s.email.sent) parts.push(t(`${s.email.sent} sent · ${pct(s.email.opened, s.email.delivered)} opened`, `${s.email.sent} enviados · ${pct(s.email.opened, s.email.delivered)} abiertos`))
    if (s.email.recorded) parts.push(t(`${s.email.recorded} recorded (test)`, `${s.email.recorded} registrados (prueba)`))
  } else if (type === 'branch') {
    if (s.yes || s.no) parts.push(t(`Yes ${s.yes} · No ${s.no}`, `Sí ${s.yes} · No ${s.no}`))
  } else if (type === 'wait_until') {
    if (s.met || s.timedOut) parts.push(`${s.met} · ${s.timedOut}`)
  } else if (s.applied) {
    parts.push(String(s.applied))
  }
  if (s.here - s.failedHere > 0) parts.unshift(type === 'delay' || type === 'wait_until' ? t(`${s.here - s.failedHere} waiting`, `${s.here - s.failedHere} esperando`) : t(`${s.here - s.failedHere} here`, `${s.here - s.failedHere} aquí`))
  if (s.failedHere) parts.push(t(`${s.failedHere} stuck`, `${s.failedHere} con fallo`))
  return parts.join(' · ')
}

const triggerStats = computed(() => {
  const r = b.stats.value.rule
  if (!r) return ''
  const parts = [t(`${r.entered} entered · 30 days`, `${r.entered} entraron · 30 días`)]
  if (r.inside) parts.push(t(`${r.inside} inside now`, `${r.inside} dentro ahora`))
  return parts.join(' · ')
})

function isSelected(id: string) {
  const s = b.selection.value
  return (id === 'trigger' && s?.kind === 'trigger') || (s?.kind === 'step' && s.id === id)
}
function selectNode(id: string) {
  b.selection.value = id === 'trigger' ? { kind: 'trigger' } : { kind: 'step', id }
}
function openInsert(point: InsertPoint) {
  if (props.readOnly) return
  b.selection.value = { kind: 'insert', point }
  emit('insert', point)
}
const activeInsert = computed(() => (b.selection.value?.kind === 'insert' ? b.selection.value.point : null))
const insertKey = (p: InsertPoint) => `${p.parentId ?? ''}|${p.branch ?? ''}|${p.index}`

// The popover sits beside the "+" that opened it, in screen space so it does
// not shrink with the zoom -- kept inside the viewport.
const menuStyle = computed(() => {
  const p = activeInsert.value
  const el = viewport.value
  if (!p || !el) return {}
  const x = p.x * zoom.value + pan.value.x + 22
  const y = p.y * zoom.value + pan.value.y - 20
  return {
    left: `${Math.max(8, Math.min(x, el.clientWidth - 308))}px`,
    top: `${Math.max(8, Math.min(y, el.clientHeight - 420))}px`,
  }
})
function pickStep(type: string) {
  const p = activeInsert.value
  if (p) b.addStep(p, type)
}
</script>

<template>
  <div
    ref="viewport"
    class="relative h-full w-full touch-none select-none overflow-hidden bg-surface-page"
    style="background-image: radial-gradient(rgb(var(--color-line-control)) 1px, transparent 1px); background-size: 18px 18px;"
    data-test="flow-canvas"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
  >
    <div
      class="absolute left-0 top-0 origin-top-left"
      :style="{ width: `${layout.width}px`, height: `${layout.height}px`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
    >
      <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible" :viewBox="`0 0 ${layout.width} ${layout.height}`" aria-hidden="true" data-test="flow-edges">
        <path v-for="edge in layout.edges" :key="edge.id" :d="edge.d" fill="none" stroke-width="1.5" class="stroke-line-controlHover" />
      </svg>

      <span
        v-for="label in layout.labels"
        :key="`${label.parentId}-${label.branch}`"
        class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11px] font-semibold"
        :class="label.branch === 'yes' || label.branch === 'met' ? 'border-success-border bg-success-bg text-success-text' : 'border-line bg-surface text-ink-500'"
        :style="{ left: `${label.x}px`, top: `${label.y}px` }"
        :data-test="`outlet-${label.parentId}-${label.branch}`"
      >{{ outletLabel(t, b.stepsById.value.get(label.parentId), label.branch) }}</span>

      <div v-for="node in layout.nodes" :key="node.id" class="absolute" :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: `${node.h}px` }">
        <AutomationsStepNode
          v-if="node.kind === 'trigger'"
          kind="trigger"
          :eyebrow="say(t, KIND_LABEL.trigger)"
          :title="triggerTitle(t, b.draft.value.rule.trigger_event, b.draft.value.rule.filters)"
          :detail="triggerDetail(t, b.draft.value.rule, b.lookup.value)"
          :stats="triggerStats"
          :growth="b.isLead.value"
          :locked="b.isLead.value && !b.hasGrowth.value"
          :problem="b.problems.value.some((p) => !p.stepId)"
          :selected="isSelected('trigger')"
          test-id="node-trigger"
          @select="selectNode('trigger')"
        />
        <AutomationsStepNode
          v-else-if="node.kind === 'end'"
          kind="end"
          eyebrow=""
          :title="t('End', 'Fin')"
          :test-id="`node-end-${node.chain?.parentId ?? 'root'}-${node.chain?.branch ?? 'root'}`"
          @select="b.selection.value = null"
        />
        <AutomationsStepNode
          v-else-if="b.stepsById.value.get(node.id)"
          :kind="stepDef(b.stepsById.value.get(node.id)!.action_type)?.kind ?? 'action'"
          :eyebrow="stepEyebrow(t, b.stepsById.value.get(node.id)!.action_type)"
          :title="stepTitle(t, b.stepsById.value.get(node.id)!, b.lookup.value)"
          :detail="stepDetail(t, b.stepsById.value.get(node.id)!, b.lookup.value, b.draft.value.rule)"
          :stats="statsLine(node.id, b.stepsById.value.get(node.id)!.action_type)"
          :growth="!!stepDef(b.stepsById.value.get(node.id)!.action_type)?.leadOnly"
          :locked="!!stepDef(b.stepsById.value.get(node.id)!.action_type)?.leadOnly && !b.hasGrowth.value"
          :problem="problemSteps.has(node.id)"
          :selected="isSelected(node.id)"
          :test-id="`node-${node.id}`"
          @select="selectNode(node.id)"
        />
      </div>

      <template v-if="!readOnly">
        <button
          v-for="p in layout.inserts"
          :key="insertKey(p)"
          type="button"
          class="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[14px] font-semibold leading-none shadow-card touch:h-9 touch:w-9"
          :class="activeInsert && insertKey(activeInsert) === insertKey(p) ? 'border-brand bg-brand text-surface' : 'border-line-control bg-surface text-ink-muted hover:border-brand hover:text-brand-text'"
          :style="{ left: `${p.x}px`, top: `${p.y}px` }"
          :aria-label="t('Add a step here', 'Añadir un paso aquí')"
          :data-test="`insert-${p.parentId ?? 'root'}-${p.branch ?? 'root'}-${p.index}`"
          @click.stop="openInsert(p)"
        >+</button>
      </template>
    </div>

    <AutomationsAddStepMenu
      v-if="popoverMenu && activeInsert && !readOnly"
      class="absolute z-10"
      :style="menuStyle"
      :is-lead="b.isLead.value"
      :has-growth="b.hasGrowth.value"
      @pick="pickStep"
      @close="b.selection.value = null"
    />

    <div class="absolute bottom-4 left-4 flex items-center gap-1 rounded-card border border-line bg-surface p-1 shadow-card" data-test="canvas-controls">
      <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctl text-[16px] text-ink-700 hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Zoom out', 'Alejar')" @click="zoomBy(1 / 1.2)">−</button>
      <span class="w-12 text-center font-mono text-[11.5px] text-ink-muted" data-test="canvas-zoom">{{ Math.round(zoom * 100) }} %</span>
      <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctl text-[16px] text-ink-700 hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Zoom in', 'Acercar')" @click="zoomBy(1.2)">+</button>
      <button type="button" class="h-8 rounded-ctl px-2.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle touch:h-11" data-test="canvas-fit" @click="fit">{{ t('Fit', 'Ajustar') }}</button>
      <span class="mx-0.5 h-5 w-px bg-line-divider" />
      <button
        type="button"
        class="h-8 rounded-ctl px-2.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 touch:h-11"
        :disabled="!b.canUndo.value || readOnly"
        :title="t('Undo (Ctrl/Cmd + Z)', 'Deshacer (Ctrl/Cmd + Z)')"
        data-test="canvas-undo"
        @click="b.undo()"
      >{{ t('Undo', 'Deshacer') }}</button>
    </div>
    <span class="sr-only">{{ t('Each step is a button; the panel beside the canvas edits the selected one.', 'Cada paso es un botón; el panel junto al lienzo edita el seleccionado.') }}</span>
  </div>
</template>
