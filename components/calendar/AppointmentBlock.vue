<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { blockLadder, type BlockDensity } from '~/utils/appointmentBlock'
import type { AppointmentStage } from '~/utils/appointmentStage'
import { STAGE_TONE, STAGE_TONE_CLASS } from '~/composables/useAppointmentStage'
import type { VisitBono } from '~/utils/visitPayment'

// One appointment on the grid, drawn the way the canvas's BlockAnatomy board
// lays it out:
//
// - The BORDER is the stage's shape: dashed while the visit is not firm
//   (unconfirmed, booked online, wants to move), solid once it is.
// - The PILL says where the patient is in the visit.
// - RED means money, and nothing else.
// - The appointment type's colour is a tint and a small square, never a bar,
//   and is mixed against the surface token so the same type reads correctly
//   in dark mode.
//
// What fits is decided by utils/appointmentBlock (blockLadder) from the size
// this block actually renders at, which it measures itself.

export interface BlockView {
  id: string
  name: string
  shortName: string
  stage: AppointmentStage
  /** "17:36", for "Llegó 17:36". */
  arrivedAt: string | null
  /** "18:00". */
  timeLabel: string
  typeName: string | null
  /** From appointment_types.color -- data, never a literal. */
  typeColor: string | null
  practitionerName: string | null
  /** The patient's whole unpaid balance, not just this visit's. */
  owesCents: number
  bono: VisitBono | null
  /** The patient has a sticky clinical note. */
  hasNote: boolean
  movedCount: number
  noNext: boolean
}

const props = withDefaults(
  defineProps<{
    view: BlockView
    density: BlockDensity
    /** Rendered height in px -- the grid knows it; width is measured. */
    height: number
    selected?: boolean
    dim?: boolean
    privacy?: boolean
  }>(),
  { selected: false, dim: false, privacy: false },
)

const t = useT()
const { stageLabel } = useStageLabels()

const root = ref<HTMLElement | null>(null)
// A guess until the first measurement lands: wide enough for the label pill,
// so a day block does not flash its icon-only form on mount.
const width = ref(props.density === 'week' ? 82 : 240)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!root.value) return
  width.value = root.value.offsetWidth || width.value
  // Border box: the ladder budgets the padding and border itself.
  observer = new ResizeObserver(([entry]) => (width.value = entry.borderBoxSize?.[0]?.inlineSize ?? (entry.target as HTMLElement).offsetWidth))
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const pillText = computed(() => stageLabel(props.view.stage, props.view.arrivedAt))
const owesText = computed(() => t(`Owes ${formatEur(props.view.owesCents)}`, `Debe ${formatEur(props.view.owesCents)}`))
const bonoText = computed(() => (props.view.bono ? `Bono ${props.view.bono.remaining}/${props.view.bono.total}` : ''))

const ladder = computed(() =>
  blockLadder({
    density: props.density,
    width: width.value,
    height: props.height,
    stage: props.view.stage,
    owes: props.view.owesCents > 0,
    bono: !!props.view.bono,
    note: props.view.hasNote,
    moved: props.view.movedCount,
    noNext: props.view.noNext,
    pillText: pillText.value,
    owesText: owesText.value,
    bonoText: bonoText.value,
  }),
)

const week = computed(() => props.density === 'week')
const typeColor = computed(() => props.view.typeColor || 'rgb(var(--color-brand))')
const mix = (pct: number) => `color-mix(in srgb, ${typeColor.value} ${pct}%, rgb(var(--color-surface)))`

// Fill and border per stage. Only the type-tinted ones need inline style; the
// rest are tokens.
const boxStyle = computed(() => {
  switch (props.view.stage) {
    case 'pending':
    case 'online':
      return { background: 'rgb(var(--color-surface))', border: `1.5px dashed ${mix(80)}` }
    case 'resched':
    case 'completed':
    case 'noshow':
    case 'cancelled':
      return {}
    default:
      return { background: mix(16), border: `1px solid ${mix(50)}` }
  }
})
const boxClass = computed(() => {
  switch (props.view.stage) {
    case 'resched':
      return 'bg-warning-bg border-[1.5px] border-dashed border-warning-accent'
    case 'completed':
      return 'bg-surface-subtle border border-line'
    case 'noshow':
      return 'appt-block-struck border border-line-control'
    case 'cancelled':
      return 'bg-surface-subtle border border-dashed border-line-control opacity-60'
    default:
      return ''
  }
})

const lowBono = computed(() => !!props.view.bono && props.view.bono.remaining <= 1)
const struck = computed(() => props.view.stage === 'noshow' || props.view.stage === 'cancelled')

const metaText = computed(() => {
  if (ladder.value.meta === 'time') return props.view.timeLabel
  return [props.view.timeLabel, props.view.typeName, props.view.practitionerName].filter(Boolean).join(' · ')
})

const ariaLabel = computed(() =>
  [
    props.view.name,
    props.view.timeLabel,
    props.view.typeName,
    pillText.value,
    props.view.owesCents > 0 ? owesText.value : null,
  ]
    .filter(Boolean)
    .join(', '),
)
</script>

<template>
  <div
    ref="root"
    class="relative flex h-full w-full flex-col overflow-hidden text-ink-900 transition-opacity"
    :class="[
      boxClass,
      week ? 'rounded-[6px]' : 'rounded-ctl',
      ladder.compact ? (week ? 'justify-center px-1 py-0.5' : 'justify-center px-2') : week ? 'gap-px px-[5px] py-1' : 'gap-[3px] px-[9px] py-1.5',
      selected ? 'ring-2 ring-brand ring-offset-2 ring-offset-brand-tint' : '',
      dim ? 'opacity-[.28]' : '',
    ]"
    :style="boxStyle"
    :data-stage="view.stage"
    :aria-label="ariaLabel"
  >
    <div class="flex min-w-0 items-center gap-[5px]">
      <span
        class="min-w-0 shrink truncate font-semibold leading-[1.2]"
        :class="[
          week ? 'text-[11px]' : 'text-[13px]',
          view.stage === 'completed' ? 'text-ink-muted' : 'text-ink-900',
          struck ? 'line-through' : '',
          privacy ? 'select-none blur-sm' : '',
        ]"
        data-cy="appt-block-name"
      >{{ ladder.shortName ? view.shortName : view.name }}</span>
      <span v-if="ladder.note" class="inline-flex shrink-0 text-warning-accent" :title="t('Clinical note', 'Nota clínica')" data-cy="appt-block-note">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" :aria-label="t('Clinical note', 'Nota clínica')"><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4" /></svg>
      </span>
      <span class="grow" />
      <span
        v-if="ladder.pill !== 'none'"
        class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none"
        :class="[STAGE_TONE_CLASS[STAGE_TONE[view.stage]], week ? 'text-[10px]' : 'text-[11px]', ladder.pill === 'label' ? 'px-[7px] py-[3px]' : 'p-[2px]']"
        :title="pillText"
        data-cy="appt-block-stage"
      >
        <CalendarStageIcon :stage="view.stage" />
        <span v-if="ladder.pill === 'label'">{{ pillText }}</span>
      </span>
      <span v-if="ladder.owes === 'inline'" class="shrink-0 whitespace-nowrap rounded-[5px] border border-danger-border bg-danger-bg px-1.5 py-0.5 text-[11px] font-bold text-danger-text" data-cy="appt-block-owes">{{ owesText }}</span>
    </div>

    <div v-if="ladder.meta !== 'none' || ladder.owes === 'meta'" class="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted" :class="ladder.wrap ? 'flex-wrap' : ''">
      <span class="h-2 w-2 shrink-0 rounded-[2px]" :class="view.stage === 'completed' ? 'opacity-45' : ''" :style="{ background: typeColor }" />
      <span v-if="ladder.meta !== 'none'" class="min-w-0 shrink truncate">{{ metaText }}</span>
      <span class="grow" />
      <span v-if="ladder.moved" class="inline-flex shrink-0 items-center gap-0.5" :title="t('Moved before', 'Movida antes')" data-cy="appt-block-moved">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>{{ view.movedCount }}
      </span>
      <span v-if="ladder.noNext" class="shrink-0 whitespace-nowrap rounded-[5px] border border-dashed border-line-control px-1.5 py-px text-[11px] font-semibold text-ink-500" data-cy="appt-block-no-next">{{ t('No next visit', 'Sin próxima') }}</span>
      <span
        v-if="ladder.bono"
        class="shrink-0 whitespace-nowrap rounded-[5px] border px-1.5 py-px text-[11px] font-semibold"
        :class="lowBono ? 'border-warning-border bg-warning-bg text-warning-text' : 'border-brand-tintBorder bg-brand-tint text-brand-text'"
        data-cy="appt-block-bono"
      >{{ bonoText }}</span>
      <span v-if="ladder.owes === 'meta'" class="shrink-0 whitespace-nowrap rounded-[5px] border border-danger-border bg-danger-bg px-1.5 py-0.5 text-[11px] font-bold text-danger-text" data-cy="appt-block-owes">{{ owesText }}</span>
    </div>

    <span
      v-if="ladder.owes === 'dot'"
      class="absolute bottom-[3px] right-[3px] flex h-[13px] w-[13px] items-center justify-center rounded-full bg-danger-text text-[9px] font-bold text-surface"
      :title="owesText"
      data-cy="appt-block-owes"
    >€</span>

    <div v-if="selected && !week" class="absolute bottom-0.5 left-1/2 h-1 w-7 -translate-x-1/2 rounded-sm bg-brand" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* A no-show keeps its slot visible but reads as "did not happen": stripes in
   two surface tokens, so it stays neutral in both themes -- red is reserved
   for money. */
.appt-block-struck {
  background: repeating-linear-gradient(135deg, rgb(var(--color-chip-bg)) 0 6px, rgb(var(--color-surface)) 6px 12px);
}
</style>
