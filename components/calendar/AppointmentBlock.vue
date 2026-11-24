<script setup lang="ts">
// Relative, not ~/: the app (mobile/) draws its agenda with this block too,
// and there ~ is mobile/.
import { formatEur } from '../../utils/billing'
import { blockLadder, type BlockDensity } from '../../utils/appointmentBlock'
import { pendingFormsLabel, type AppointmentStage } from '../../utils/appointmentStage'
import { STAGE_TONE, STAGE_TONE_CLASS } from '../../composables/useAppointmentStage'
import type { VisitBono } from '../../utils/visitPayment'
import { calendarBlockColors } from '../../utils/calendarPalette'

// One appointment on the grid, drawn the way the canvas's BlockAnatomy board
// lays it out:
//
// - The BORDER is the stage's shape: dashed while the visit is not firm
//   (unconfirmed, booked online, wants to move), solid once it is.
// - The PILL says where the patient is in the visit.
// - RED means money, and nothing else.
// - The appointment type's colour fills a live visit as chosen, never a bar;
//   the text on it turns white or near-black (calendarBlockColors). Unfirm,
//   done and struck visits keep their own looks, with the colour as an edge
//   or a faint tint.
//
// What fits is decided by utils/appointmentBlock (blockLadder) from the size
// this block actually renders at, which it measures itself.

/** A care plan's re-exam visit (care_plan_marked_visits). */
export interface VisitMarkerView {
  /** Its number in the plan. */
  visit: number
  label: string
  /** Booked as another type than the plan asks for. */
  mismatch: boolean
  expectedTypeId: string | null
  expectedTypeName: string | null
}

/** Whose visit it is, drawn on the whole-clinic tab only (PractitionerBadge). */
export interface PractitionerBadgeView {
  /** practitionerBadgeLabels: "L", or "LM" where L alone is ambiguous. */
  initials: string
  /** team_members.color; null when the visit has no practitioner. */
  color: string | null
  /** The full name; null when the visit has no practitioner. */
  name: string | null
}

export interface BlockView {
  id: string
  name: string
  shortName: string
  /** patients.first_name and last_name (both surnames), trimmed: week view
   *  prints more of the name from them where a block has the room. Absent,
   *  it keeps the short name. */
  firstName?: string
  lastName?: string
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
  /** Forms sent to the patient and not completed, where worth saying (pendingFormsFlag); 0 for none. */
  pendingForms: number
  /** patients.red_flags, trimmed; null for none. The text only shows to clinical roles. */
  redFlags?: string | null
  /** patients.tags, as the record keeps them. */
  tags?: string[]
  movedCount: number
  noNext: boolean
  marker?: VisitMarkerView | null
  /** Set on the whole-clinic tab only: one practitioner's own tab has no
   *  need to say whose each visit is. */
  practitioner?: PractitionerBadgeView | null
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
    /** Lead a one-line block with its start time. The calendar's rows mode
     *  stacks visits one per line, off their exact times, so the line says it. */
    leadTime?: boolean
  }>(),
  { selected: false, dim: false, privacy: false, leadTime: false },
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
const formsText = computed(() => pendingFormsLabel(props.view.pendingForms, t))
const noNextText = computed(() => t('No next visit booked', 'Sin próxima cita reservada'))
// Two or more live bonos (their own and a family one shared with them): the
// checkout asks which pays, so the block names none of them either.
const severalBonos = computed(() => (props.view.bono?.choices ?? 0) > 1)
const bonoText = computed(() => {
  const bono = props.view.bono
  if (!bono) return ''
  return severalBonos.value ? t(`${bono.choices} bonos`, `${bono.choices} bonos`) : `Bono ${bono.remaining}/${bono.total}`
})

// "09:30" and its gap, at the 11.5px mono the time is set in.
const LEAD_TIME_PX = 40
const ladder = computed(() =>
  blockLadder({
    density: props.density,
    width: width.value - (props.leadTime ? LEAD_TIME_PX : 0),
    height: props.height,
    stage: props.view.stage,
    owes: props.view.owesCents > 0,
    bono: !!props.view.bono,
    note: props.view.hasNote,
    forms: props.view.pendingForms > 0,
    moved: props.view.movedCount,
    noNext: props.view.noNext,
    marker: !!props.view.marker,
    badgeText: props.view.practitioner ? props.view.practitioner.initials || '?' : undefined,
    pillText: pillText.value,
    nameText: props.density === 'week' ? props.view.shortName : props.view.name,
    firstName: props.view.firstName,
    lastName: props.view.lastName,
    redFlag: !!props.view.redFlags,
    owesText: owesText.value,
    bonoText: bonoText.value,
  }),
)

const week = computed(() => props.density === 'week')
const typeColor = computed(() => props.view.typeColor || 'rgb(var(--color-brand))')
const mix = (pct: number) => `color-mix(in srgb, ${typeColor.value} ${pct}%, rgb(var(--color-surface)))`
// A live visit is painted in its type's colour exactly as the clinic chose it
// (Settings > Appointment types): a deeper pick is a deeper block, a softer
// pick a softer one, and the text turns white or near-black to stay readable.
// The calendar does not tone it down; how loud it is is the clinic's call.
const solid = computed(() => calendarBlockColors(props.view.typeColor))
// A finished visit keeps its type's colour, greyed and a shade deeper than
// a live one (the .appt-block-done rule below). Dropping the colour entirely
// made a morning of done visits one grey slab, with no telling an Ajuste
// from a Primera visita.

// Fill and border per stage. Only the type-tinted ones need inline style; the
// rest are tokens.
const boxStyle = computed(() => {
  switch (props.view.stage) {
    case 'pending':
    case 'online':
      return { background: 'rgb(var(--color-surface))', border: `1.5px dashed ${solid.value?.fill ?? mix(80)}` }
    case 'completed':
      return { '--appt-type': typeColor.value }
    case 'resched':
    case 'noshow':
    case 'cancelled':
      return {}
    default:
      if (solid.value) {
        return { background: solid.value.fill, border: `1px solid ${solid.value.border}`, '--appt-on': solid.value.text, '--appt-on-muted': solid.value.textMuted }
      }
      return { background: mix(16), border: `1px solid ${mix(50)}` }
  }
})
const isSolid = computed(() => !!solid.value && !['pending', 'online', 'completed', 'resched', 'noshow', 'cancelled'].includes(props.view.stage))
const boxClass = computed(() => {
  switch (props.view.stage) {
    case 'completed':
      return 'appt-block-done'
    case 'resched':
      return 'bg-warning-bg border-[1.5px] border-dashed border-warning-accent'
    case 'noshow':
      return 'appt-block-struck border border-line-control'
    case 'cancelled':
      return 'bg-surface-subtle border border-dashed border-line-control opacity-60'
    default:
      return ''
  }
})

const lowBono = computed(() => !!props.view.bono && !severalBonos.value && props.view.bono.remaining <= 1)
const struck = computed(() => props.view.stage === 'noshow' || props.view.stage === 'cancelled')

const metaText = computed(() => {
  if (ladder.value.meta === 'time') return props.view.timeLabel
  // The badge already says whose visit it is; the name would repeat it in
  // the line the bono and the other chips compete for.
  return [props.view.timeLabel, props.view.typeName, props.view.practitioner ? null : props.view.practitionerName].filter(Boolean).join(' · ')
})

const markerText = computed(() => {
  const m = props.view.marker
  if (!m) return ''
  const what = t(`Visit ${m.visit} · ${m.label}`, `Visita ${m.visit} · ${m.label}`)
  return m.mismatch && m.expectedTypeName ? `${what} — ${t(`should be ${m.expectedTypeName}`, `debería ser ${m.expectedTypeName}`)}` : what
})

const ariaLabel = computed(() =>
  [
    props.view.name,
    props.view.practitioner ? (props.view.practitioner.name ?? t('No practitioner', 'Sin profesional')) : null,
    props.view.timeLabel,
    props.view.typeName,
    markerText.value || null,
    pillText.value,
    props.view.owesCents > 0 ? owesText.value : null,
    props.view.pendingForms > 0 ? formsText.value : null,
    props.view.noNext ? noNextText.value : null,
    props.view.redFlags ? t('Red flags on the record', 'Señales rojas en la ficha') : null,
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
      isSolid ? 'appt-solid' : '',
      week ? 'rounded-[6px]' : 'rounded-ctl',
      ladder.compact ? (week ? 'justify-center px-1 py-0.5' : 'justify-center px-2') : week ? (ladder.tight ? 'justify-center gap-px px-[5px] py-px' : 'gap-px px-[5px] py-1') : 'gap-[3px] px-[9px] py-1.5',
      selected ? 'ring-2 ring-brand ring-offset-2 ring-offset-brand-tint' : '',
      dim ? 'opacity-[.28]' : '',
    ]"
    :style="boxStyle"
    :data-stage="view.stage"
    :aria-label="ariaLabel"
  >
    <div class="flex min-w-0 items-center gap-[5px]">
      <span v-if="leadTime && ladder.compact" class="shrink-0 font-mono text-[11.5px] text-ink-muted" data-cy="appt-block-lead-time">{{ view.timeLabel }}</span>
      <CalendarPractitionerBadge
        v-if="ladder.badge === 'name' && view.practitioner"
        :initials="view.practitioner.initials"
        :color="view.practitioner.color"
        :name="view.practitioner.name"
        :size="week ? 'sm' : 'md'"
        :class="view.stage === 'completed' || struck ? 'opacity-70' : ''"
      />
      <span
        class="min-w-0 shrink truncate font-semibold"
        :class="[
          ladder.tight ? 'leading-[1.15]' : 'leading-[1.2]',
          week ? 'text-[11px]' : 'text-[13px]',
          view.stage === 'completed' ? 'text-ink-muted' : 'text-ink-900',
          struck ? 'line-through' : '',
          privacy ? 'select-none blur-sm' : '',
        ]"
        data-cy="appt-block-name"
      >{{ ladder.nameLines?.[0] ?? ladder.fullerName ?? (ladder.shortName ? view.shortName : view.name) }}</span>
      <span
        v-if="ladder.marker"
        class="inline-flex shrink-0"
        :class="view.marker?.mismatch ? 'rounded-[4px] bg-warning-bg px-px text-warning-text' : 'text-brand-text'"
        :title="markerText"
        data-cy="appt-block-marker"
        :data-mismatch="view.marker?.mismatch ? 'true' : undefined"
      >
        <CalendarVisitMarkerIcon />
      </span>
      <!-- Before anything else after the name, and never dropped for room:
           it is the one thing on the block about the patient's safety. -->
      <span v-if="view.redFlags" class="inline-flex shrink-0 text-danger-text" :title="t('Red flags on the record', 'Señales rojas en la ficha')" data-cy="appt-block-red-flags">
        <CalendarRedFlagIcon :size="week ? 11 : 12" :label="t('Red flags on the record', 'Señales rojas en la ficha')" />
      </span>
      <!-- A clipboard, not the note's page: the two sit side by side. -->
      <span v-if="ladder.forms" class="inline-flex shrink-0 text-warning-text" :title="formsText" data-cy="appt-block-forms">
        <CalendarBlockIcon kind="forms" :size="week ? 11 : 12" />
      </span>
      <span v-if="ladder.noNext" class="inline-flex shrink-0 text-ink-500" :title="noNextText" data-cy="appt-block-no-next">
        <CalendarBlockIcon kind="noNext" :size="week ? 11 : 12" />
      </span>
      <span v-if="ladder.note" class="inline-flex shrink-0 text-warning-accent" :title="t('Clinical note', 'Nota clínica')" data-cy="appt-block-note">
        <CalendarBlockIcon kind="note" />
      </span>
      <span class="grow" />
      <span
        v-if="ladder.pill !== 'none'"
        class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none"
        :class="[STAGE_TONE_CLASS[STAGE_TONE[view.stage]], week ? 'text-[11px]' : 'text-[11px]', ladder.pill === 'label' ? 'px-[7px] py-[3px]' : 'p-[2px]']"
        :title="pillText"
        data-cy="appt-block-stage"
      >
        <CalendarStageIcon :stage="view.stage" />
        <span v-if="ladder.pill === 'label'">{{ pillText }}</span>
      </span>
      <span v-if="ladder.owes === 'inline'" class="shrink-0 whitespace-nowrap rounded-[5px] border border-danger-border bg-danger-bg px-1.5 py-0.5 text-[11px] font-bold text-danger-text" data-cy="appt-block-owes">{{ owesText }}</span>
    </div>

    <!-- Week view's narrow columns: the surnames under the first name. -->
    <span
      v-if="ladder.nameLines"
      class="min-w-0 truncate text-[11px] font-semibold"
      :class="[ladder.tight ? 'leading-[1.15]' : 'leading-[1.2]', view.stage === 'completed' ? 'text-ink-muted' : 'text-ink-900', struck ? 'line-through' : '', privacy ? 'select-none blur-sm' : '']"
      data-cy="appt-block-surname"
    >{{ ladder.nameLines[1] }}</span>

    <div v-if="ladder.meta !== 'none' || ladder.owes === 'meta' || ladder.badge === 'meta'" class="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted" :class="[ladder.wrap ? 'flex-wrap' : '', ladder.tight ? 'leading-none' : '']">
      <CalendarPractitionerBadge
        v-if="ladder.badge === 'meta' && view.practitioner"
        :initials="view.practitioner.initials"
        :color="view.practitioner.color"
        :name="view.practitioner.name"
        :class="view.stage === 'completed' || struck ? 'opacity-70' : ''"
      />
      <span v-if="!isSolid" class="h-2 w-2 shrink-0 rounded-[2px]" :class="view.stage === 'completed' ? 'opacity-70' : ''" :style="{ background: typeColor }" />
      <span v-if="ladder.meta !== 'none'" class="min-w-0 shrink truncate">{{ metaText }}</span>
      <span class="grow" />
      <span v-if="ladder.moved" class="inline-flex shrink-0 items-center gap-0.5" :title="t('Moved before', 'Movida antes')" data-cy="appt-block-moved">
        <CalendarBlockIcon kind="moved" />{{ view.movedCount }}
      </span>
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
      class="absolute bottom-[3px] right-[3px] flex h-[13px] w-[13px] items-center justify-center rounded-full bg-danger-text text-[11px] font-bold text-danger-on"
      :title="owesText"
      data-cy="appt-block-owes"
    >€</span>

    <div v-if="selected && !week" class="absolute bottom-0.5 left-1/2 h-1 w-7 -translate-x-1/2 rounded-sm bg-brand" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* Done: the type's hue at less strength than a live visit (16% into the
   surface), mixed into a base a step DEEPER than the surface -- the chip grey
   in light, the page background in dark, where the chip grey is lighter than
   the surface and would lift the block instead of settling it. */
.appt-block-done {
  --appt-done-base: var(--color-chip-bg);
  background: color-mix(in srgb, var(--appt-type) 10%, rgb(var(--appt-done-base)));
  border: 1px solid color-mix(in srgb, var(--appt-type) 22%, rgb(var(--color-line-control)));
}
[data-theme='dark'] .appt-block-done {
  --appt-done-base: var(--color-surface-page);
}

/* Live and filled with the type's colour: the block's own text follows the
   fill (--appt-on, set from calendarBlockColors), and the little markers that
   have no background of their own sit on a surface chip so they keep their
   meaning -- a red flag stays red on a red-orange block. */
.appt-solid {
  color: rgb(var(--appt-on));
}
.appt-solid [data-cy='appt-block-name'],
.appt-solid [data-cy='appt-block-surname'] {
  color: rgb(var(--appt-on));
}
.appt-solid [data-cy='appt-block-lead-time'],
.appt-solid .text-ink-muted {
  color: rgb(var(--appt-on-muted));
}
.appt-solid [data-cy='appt-block-red-flags'],
.appt-solid [data-cy='appt-block-forms'],
.appt-solid [data-cy='appt-block-no-next'],
.appt-solid [data-cy='appt-block-note'],
.appt-solid [data-cy='appt-block-marker']:not([data-mismatch]) {
  background: rgb(var(--color-surface));
  border-radius: 9999px;
  padding: 1px;
}
/* "Confirmada" is muted text with no chip of its own. */
.appt-solid [data-cy='appt-block-stage']:not([class*='bg-']) {
  background: rgb(var(--color-surface));
  color: rgb(var(--color-ink-700));
}

/* A no-show keeps its slot visible but reads as "did not happen": stripes in
   two surface tokens, so it stays neutral in both themes -- red is reserved
   for money. */
.appt-block-struck {
  background: repeating-linear-gradient(135deg, rgb(var(--color-chip-bg)) 0 6px, rgb(var(--color-surface)) 6px 12px);
}
</style>
