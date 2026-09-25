<script setup lang="ts">
import { formatTime } from '~/utils/billing'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'

// The day on a phone: one column, in time order, instead of a grid of room
// columns that does not fit 375px. The canvas's PhoneDay board.
//
// - "Mis citas" / "Toda la clínica": a practitioner checking their own day
//   between patients, or the front desk's whole-clinic view.
// - Visits already done collapse into one row -- by afternoon they are most
//   of the list and none of what anyone is looking for.
// - A red line marks now, as on the grid.
// - The next patient's sticky note shows inline, under their block: what
//   needs saying before they are in the room, without opening anything.
// - A tap opens the appointment, full screen. There is no hover card on
//   touch, and nothing on the block needs one.

export interface AgendaItem {
  id: string
  startsAt: string
  endsAt: string
  view: BlockView
  stickyNote: string | null
}

const props = defineProps<{
  items: AgendaItem[]
  scope: 'mine' | 'all'
  /** Whether "Mis citas" means anything: the signed-in user is a practitioner here. */
  canScopeMine: boolean
  counts: { unconfirmed: number; waiting: number; owe: number }
  privacy?: boolean
  now: Date
  isToday: boolean
  /** False for a read-only calendar (calendar_read_only). */
  canCreate?: boolean
}>()
const emit = defineEmits<{ open: [id: string]; scope: [value: 'mine' | 'all']; create: [] }>()

const t = useT()
const doneOpen = ref(false)

const done = computed(() => props.items.filter((i) => i.view.stage === 'completed'))
const rest = computed(() => props.items.filter((i) => i.view.stage !== 'completed'))
const doneRange = computed(() => (done.value.length ? `${formatTime(done.value[0].startsAt)}–${formatTime(done.value[done.value.length - 1].endsAt)}` : ''))

// The next patient: the first visit still to happen or waiting to go in.
const nextId = computed(() => rest.value.find((i) => ['arrived', 'confirmed', 'pending', 'online', 'resched'].includes(i.view.stage))?.id ?? null)
// Where the now-line goes: before the first visit that has not started yet.
const nowIndex = computed(() => {
  if (!props.isToday) return -1
  const n = props.now.getTime()
  const i = rest.value.findIndex((x) => new Date(x.startsAt).getTime() > n)
  return i === -1 ? rest.value.length : i
})
// Blocks grow a little with the visit's length, so an hour reads longer than
// a quarter without the grid's full proportions.
const heightFor = (i: AgendaItem) => {
  const mins = (new Date(i.endsAt).getTime() - new Date(i.startsAt).getTime()) / 60000
  return mins >= 60 ? 72 : 56
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col bg-surface-page" data-cy="phone-agenda">
    <div class="shrink-0 border-b border-line bg-surface px-4 pb-2.5 pt-2">
      <div v-if="canScopeMine" role="tablist" class="grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-1">
        <button
          type="button"
          role="tab"
          data-cy="agenda-scope-mine"
          :aria-selected="scope === 'mine'"
          class="h-11 rounded-ctlSm text-[14px] font-semibold"
          :class="scope === 'mine' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'"
          @click="emit('scope', 'mine')"
        >
          {{ t('My appointments', 'Mis citas') }}<template v-if="scope === 'mine'"> · {{ items.length }}</template>
        </button>
        <button
          type="button"
          role="tab"
          data-cy="agenda-scope-all"
          :aria-selected="scope === 'all'"
          class="h-11 rounded-ctlSm text-[14px] font-semibold"
          :class="scope === 'all' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'"
          @click="emit('scope', 'all')"
        >
          {{ t('Whole clinic', 'Toda la clínica') }}<template v-if="scope === 'all'"> · {{ items.length }}</template>
        </button>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ink-700" data-cy="agenda-counts">
        <span v-if="counts.unconfirmed" class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-warning-accent" /><strong>{{ counts.unconfirmed }}</strong> {{ t('unconfirmed', 'sin confirmar') }}</span>
        <span v-if="counts.waiting" class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-success-accent" /><strong>{{ counts.waiting }}</strong> {{ t('waiting', 'esperando') }}</span>
        <span v-if="counts.owe" class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-danger-text" /><strong>{{ counts.owe }}</strong> {{ t('owe', 'deben') }}</span>
      </div>
    </div>

    <ol class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-40 pt-3">
      <li v-if="done.length">
        <button type="button" class="flex min-h-11 w-full items-center justify-between rounded-ctl border border-line bg-surface-subtle px-3.5 text-[13.5px] font-semibold text-ink-500" data-cy="agenda-done" :aria-expanded="doneOpen" @click="doneOpen = !doneOpen">
          {{ t(`${done.length} done · ${doneRange}`, `${done.length} ${done.length === 1 ? 'hecha' : 'hechas'} · ${doneRange}`) }}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" :class="doneOpen ? 'rotate-180' : ''" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <ol v-if="doneOpen" class="mt-2 space-y-2">
          <li v-for="i in done" :key="i.id" class="flex items-start gap-2.5">
            <span class="w-11 shrink-0 pt-1.5 font-mono text-[12px] text-ink-muted">{{ formatTime(i.startsAt) }}</span>
            <button type="button" class="min-w-0 flex-1 text-left" data-cy="agenda-item" :data-appt-id="i.id" @click="emit('open', i.id)">
              <CalendarAppointmentBlock :view="i.view" density="day" :height="56" :privacy="privacy" />
            </button>
          </li>
        </ol>
      </li>

      <template v-for="(i, idx) in rest" :key="i.id">
        <li v-if="idx === nowIndex" class="flex items-center gap-2.5" data-cy="agenda-now">
          <span class="w-11 shrink-0 font-mono text-[12px] font-semibold text-danger-text">{{ formatTime(now) }}</span>
          <span class="h-0.5 flex-1 rounded bg-danger-text" />
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-11 shrink-0 pt-1.5 font-mono text-[12px] text-ink-muted">{{ formatTime(i.startsAt) }}</span>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <button type="button" class="text-left" data-cy="agenda-item" :data-appt-id="i.id" :data-stage="i.view.stage" @click="emit('open', i.id)">
              <CalendarAppointmentBlock :view="i.view" density="day" :height="heightFor(i)" :privacy="privacy" />
            </button>
            <div v-if="i.id === nextId && i.stickyNote" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] leading-snug text-ink-700" data-cy="agenda-next-note">
              <strong class="text-warning-text">{{ t('Note:', 'Nota:') }}</strong> {{ i.stickyNote }}
            </div>
          </div>
        </li>
      </template>
      <li v-if="nowIndex === rest.length && rest.length" class="flex items-center gap-2.5" data-cy="agenda-now">
        <span class="w-11 shrink-0 font-mono text-[12px] font-semibold text-danger-text">{{ formatTime(now) }}</span>
        <span class="h-0.5 flex-1 rounded bg-danger-text" />
      </li>
      <li v-if="!items.length" class="py-10 text-center text-[14px] text-ink-muted">{{ t('Nothing booked this day.', 'No hay citas este día.') }}</li>
    </ol>

    <!-- Above the corner, not in it: the app's help launcher already sits there. -->
    <button
      v-if="canCreate !== false"
      type="button"
      :aria-label="t('New appointment', 'Nueva cita')"
      data-cy="agenda-new"
      class="absolute bottom-24 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-surface shadow-popover"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="emit('create')"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  </div>
</template>
