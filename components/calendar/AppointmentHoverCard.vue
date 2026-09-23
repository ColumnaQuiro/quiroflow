<script setup lang="ts">
import { formatEur, formatShortDate, formatTime } from '~/utils/billing'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'
import type { StageFacts } from '~/composables/useAppointmentStage'

// What a glance at a visit needs, and nothing to do: the card is read-only.
// It used to carry a note field, a sticky-note textarea, and Check in /
// Reschedule / Open chart buttons, which made it a second, smaller
// appointment screen that vanished the moment the pointer drifted off it --
// with a half-typed note in it. Every action now lives in the panel a click
// (or Enter) opens, and this card tells you what that panel will say.
//
// Order, as on the canvas: who, when, where the patient is, money, this
// visit's bono, the patient's sticky note, and how to open it. Keyboard focus
// on a block shows the same card; touch screens get none, and a tap opens
// the panel, whose header repeats all of it.

interface HoverAppointment extends StageFacts {
  id: string
  patient_id: string
  starts_at: string
  ends_at: string
  patients: { first_name: string; last_name: string | null; sticky_note: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const props = defineProps<{
  appointment: HoverAppointment
  view: BlockView
  roomName?: string | null
  /** This visit's price, for "nothing owed · 45 € at checkout". */
  priceCents?: number | null
  /** The visit has already been paid for or drawn from a bono. */
  paid?: boolean
}>()

const t = useT()
const { stageLine } = useStageLabels()
const { facts } = useAppointmentFacts(() => props.appointment)
const { availableCents } = usePatientFinancialSummary(() => props.appointment.patient_id)

const initials = computed(() => {
  const p = props.appointment.patients
  return `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase() || '?'
})
const inBuilding = computed(() => ['arrived', 'withp', 'checkout'].includes(props.view.stage))
const visitsLine = computed(() => {
  const f = facts.value
  if (!f) return ''
  const visits = t(`${f.visits} ${f.visits === 1 ? 'visit' : 'visits'}`, `${f.visits} ${f.visits === 1 ? 'visita' : 'visitas'}`)
  const next = f.nextVisitAt ? t(`next ${formatShortDate(f.nextVisitAt)}`, `próxima ${formatShortDate(f.nextVisitAt)}`) : t('no next visit', 'sin próxima cita')
  return `${visits} · ${next}`
})
const line = computed(() => stageLine(props.appointment, props.view.stage))
const lastMove = computed(() => facts.value?.reschedules[0] ?? null)
const unpaidDates = computed(() => (facts.value?.unpaid ?? []).map((u) => formatShortDate(u.at)).join(', '))
const unpaidCount = computed(() => facts.value?.unpaid.length ?? 0)

// The stage swatch: the same shape the block's border takes.
const swatchClass = computed(() => {
  switch (props.view.stage) {
    case 'pending':
    case 'online':
    case 'resched':
      return 'h-2 w-2.5 rounded-[2px] border-[1.5px] border-dashed border-warning-accent'
    case 'arrived':
      return 'h-2 w-2 rounded-full bg-success-accent'
    case 'withp':
      return 'h-2 w-2 rounded-full bg-info-accent'
    case 'checkout':
      return 'h-2 w-2 rounded-full bg-warning-accent'
    default:
      return 'h-2 w-2 rounded-full bg-ink-faint3'
  }
})
const lineClass = computed(() => {
  switch (props.view.stage) {
    case 'pending':
    case 'online':
    case 'resched':
    case 'checkout':
      return 'text-warning-text'
    case 'arrived':
      return 'text-success-text'
    case 'withp':
      return 'text-info-text'
    default:
      return 'text-ink-900'
  }
})
</script>

<template>
  <div role="tooltip" data-cy="appt-hover" class="hovercard-pop flex w-[296px] flex-col overflow-hidden rounded-[12px] border border-line-control bg-surface shadow-popover">
    <div class="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" :class="inBuilding ? 'bg-brand-tint text-brand-text' : 'bg-chip-bg text-ink-500'">{{ initials }}</span>
      <div class="flex min-w-0 flex-col gap-px">
        <span class="truncate text-[15px] font-bold text-ink-900">{{ view.name }}</span>
        <span class="truncate text-[12px] text-ink-muted" data-cy="appt-hover-visits">{{ visitsLine || ' ' }}</span>
      </div>
    </div>

    <div class="px-3.5 pb-3 text-[12.5px] leading-normal text-ink-700">
      <div><strong class="font-mono font-medium">{{ formatTime(appointment.starts_at) }}–{{ formatTime(appointment.ends_at) }}</strong><template v-if="appointment.appointment_types"> · {{ appointment.appointment_types.name }}</template></div>
      <div class="text-ink-muted">{{ appointment.team_members?.full_name ?? t('No practitioner', 'Sin profesional') }} · {{ roomName ?? t('No room', 'Sin sala') }}</div>
    </div>

    <div class="flex flex-col border-t border-line-divider">
      <div class="flex items-start gap-2 px-3.5 py-2.5 text-[12.5px]" data-cy="appt-hover-stage">
        <span class="mt-[5px] shrink-0" :class="swatchClass" aria-hidden="true" />
        <span class="flex flex-col gap-px">
          <strong :class="lineClass">{{ line.title }}</strong>
          <span v-if="line.sub" class="text-ink-muted">{{ line.sub }}</span>
        </span>
      </div>

      <div v-if="lastMove" class="flex items-start gap-2 border-t border-line-divider px-3.5 py-2.5 text-[12.5px]" data-cy="appt-hover-moved">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="mt-[3px] shrink-0 text-ink-muted" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>
        <span class="flex flex-col gap-px">
          <strong class="text-ink-900">{{ t(`Moved ${facts!.reschedules.length} ${facts!.reschedules.length === 1 ? 'time' : 'times'}`, `Movida ${facts!.reschedules.length} ${facts!.reschedules.length === 1 ? 'vez' : 'veces'}`) }}</strong>
          <span class="text-ink-muted">{{ t(`Last: from ${formatShortDate(lastMove.from)} ${formatTime(lastMove.from)} to ${formatShortDate(lastMove.to)} ${formatTime(lastMove.to)}`, `Última: del ${formatShortDate(lastMove.from)} ${formatTime(lastMove.from)} al ${formatShortDate(lastMove.to)} ${formatTime(lastMove.to)}`) }}</span>
        </span>
      </div>

      <!-- Money: the patient's balance, and the visits it is made of. -->
      <div v-if="view.owesCents > 0" class="flex items-start gap-2 border-y border-danger-border bg-danger-bg px-3.5 py-2.5 text-[12.5px]" data-cy="appt-hover-owes">
        <span class="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-danger-text" aria-hidden="true" />
        <span class="flex flex-col gap-px">
          <strong class="text-danger-text">{{ t(`Owes ${formatEur(view.owesCents)}`, `Debe ${formatEur(view.owesCents)}`) }}</strong>
          <span v-if="unpaidCount > 0" class="text-ink-500">{{ t(`${unpaidCount} unpaid ${unpaidCount === 1 ? 'visit' : 'visits'} · ${unpaidDates}`, `${unpaidCount} ${unpaidCount === 1 ? 'visita' : 'visitas'} sin cobrar · ${unpaidDates}`) }}</span>
        </span>
      </div>
      <div v-else class="flex items-center gap-2 border-t border-line-divider px-3.5 py-2.5 text-[12.5px] text-ink-muted" data-cy="appt-hover-owes">
        <span class="h-2 w-2 shrink-0 rounded-full bg-ink-faint3" aria-hidden="true" />
        <template v-if="availableCents > 0"><span class="font-semibold text-success-text">{{ t(`${formatEur(availableCents)} available`, `${formatEur(availableCents)} disponible`) }}</span></template>
        <template v-else>{{ t('Nothing owed', 'Sin saldo pendiente') }}</template><template v-if="!paid && !view.bono && priceCents"> · {{ t(`${formatEur(priceCents)} at checkout`, `${formatEur(priceCents)} al cobrar`) }}</template>
      </div>

      <div v-if="view.bono" class="flex items-center gap-2 px-3.5 py-2.5 text-[12.5px]" :class="view.owesCents > 0 ? '' : 'border-t border-line-divider'" data-cy="appt-hover-bono">
        <span class="h-2 w-2 shrink-0 rounded-[2px] bg-brand" aria-hidden="true" />
        <span class="text-ink-700">{{ t('This visit:', 'Esta visita:') }} <strong>{{ view.bono.packageName }}</strong><span class="text-ink-muted"> · {{ t(`${view.bono.remaining} left`, `quedan ${view.bono.remaining}`) }}</span></span>
      </div>
    </div>

    <div v-if="appointment.patients?.sticky_note" class="mx-2.5 mb-2.5 mt-1 rounded-[9px] border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-700" data-cy="appt-hover-note">
      <div class="mb-0.5 text-[11px] font-bold uppercase text-warning-text">{{ t('Patient note', 'Nota del paciente') }}</div>
      {{ appointment.patients.sticky_note }}
    </div>

    <div class="flex items-center gap-1.5 border-t border-line-divider px-3.5 py-2 text-[11.5px] text-ink-muted">
      {{ t('Click or', 'Clic o') }}
      <kbd class="rounded border border-line-control bg-surface-subtle px-[5px] py-px font-mono text-[10.5px]">{{ t('Enter', 'Intro') }}</kbd>
      {{ t('to open the appointment', 'para abrir la cita') }}
    </div>
  </div>
</template>

<style scoped>
.hovercard-pop {
  animation: hovercard-in 120ms ease-out;
}
@keyframes hovercard-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
