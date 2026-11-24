<script setup lang="ts">
import type { AppointmentStage } from '~/utils/appointmentStage'
import { STAGE_TONE, STAGE_TONE_CLASS } from '~/composables/useAppointmentStage'

// How the calendar draws itself, and what its marks mean. Opened from the
// toolbar's sliders button on a tablet or a computer, and inside the "Today"
// drawer on a phone. It used to be two cards in a permanent 238px column
// beside the grid; nobody reads a legend all day, so it no longer costs the
// grid that width.

export type DisplayKey = 'privacyMode' | 'showAvailability' | 'showCancelled' | 'hideRescheduled' | 'hideDeleted'

defineProps<{
  settings: Record<DisplayKey, boolean>
  toggles: { key: DisplayKey; label: string }[]
  /** Side by side or one under the other; null where it does not apply (month). */
  stackMode: 'columns' | 'rows' | null
}>()
const emit = defineEmits<{ toggle: [key: DisplayKey]; 'update:stackMode': [mode: 'columns' | 'rows'] }>()
const t = useT()
const { stageLabel } = useStageLabels()

const STAGE_KEY: AppointmentStage[] = ['pending', 'online', 'resched', 'confirmed', 'arrived', 'withp', 'checkout', 'completed', 'noshow']
const swatch = (stage: AppointmentStage) =>
  ['pending', 'online'].includes(stage)
    ? 'border-[1.5px] border-dashed border-ink-faint'
    : stage === 'resched'
      ? 'border-[1.5px] border-dashed border-warning-accent bg-warning-bg'
      : stage === 'completed'
        ? 'border border-line bg-surface-subtle'
        : stage === 'noshow'
          ? 'border border-line-control bg-chip-bg'
          : 'border border-line-control bg-brand-tint'
const modes = computed(() => [
  { key: 'columns' as const, label: t('Side by side', 'En columnas') },
  { key: 'rows' as const, label: t('One under the other', 'En filas') },
])
</script>

<template>
  <div class="text-[12.5px]">
    <template v-if="stackMode">
      <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Visits at the same time', 'Citas a la misma hora') }}</p>
      <div role="group" :aria-label="t('Visits at the same time', 'Citas a la misma hora')" class="mt-2 flex h-8 items-center gap-0.5 rounded-ctl border border-line-control bg-surface p-0.5 touch:h-11" data-cy="stack-mode">
        <button
          v-for="m in modes"
          :key="m.key"
          type="button"
          class="flex h-full flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 font-medium"
          :class="stackMode === m.key ? 'bg-chip-bg text-ink-900' : 'text-ink-muted hover:bg-surface-subtle'"
          :aria-pressed="stackMode === m.key"
          :data-cy="`stack-mode-${m.key}`"
          @click="emit('update:stackMode', m.key)"
        >
          <svg v-if="m.key === 'columns'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="2.5" width="3.6" height="11" rx="1" /><rect x="6.2" y="2.5" width="3.6" height="11" rx="1" /><rect x="10.9" y="2.5" width="3.6" height="11" rx="1" /></svg>
          <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="3.6" rx="1" /><rect x="1.5" y="6.2" width="13" height="3.6" rx="1" /><rect x="1.5" y="10.9" width="13" height="3.6" rx="1" /></svg>
          {{ m.label }}
        </button>
      </div>
      <div class="-mx-3.5 my-3 h-px bg-line-divider" />
    </template>

    <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Show', 'Mostrar') }}</p>
    <div class="mt-1">
      <button
        v-for="toggle in toggles"
        :key="toggle.key"
        type="button"
        role="switch"
        :aria-checked="settings[toggle.key]"
        :data-cy="`display-${toggle.key}`"
        class="flex h-8 w-full items-center justify-between gap-2 text-left text-ink-600 touch:h-11"
        @click="emit('toggle', toggle.key)"
      >
        {{ toggle.label }}
        <span class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors" :class="settings[toggle.key] ? 'bg-brand' : 'bg-toggle-off'" aria-hidden="true">
          <span class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform" :class="settings[toggle.key] ? 'translate-x-[14px]' : 'translate-x-0.5'" />
        </span>
      </button>
    </div>

    <div class="-mx-3.5 my-3 h-px bg-line-divider" />

    <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Key', 'Leyenda') }}</p>
    <p class="mt-1 text-[11.5px] leading-snug text-ink-muted">{{ t('Dashed border: not confirmed yet. Red: money owed.', 'Borde discontinuo: sin confirmar. Rojo: dinero pendiente.') }}</p>
    <div class="mt-2 space-y-1.5">
      <div v-for="stage in STAGE_KEY" :key="stage" class="flex items-center gap-2 text-ink-600">
        <span class="h-3 w-4 shrink-0 rounded-[3px]" :class="swatch(stage)" aria-hidden="true" />
        <span class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold" :class="STAGE_TONE_CLASS[STAGE_TONE[stage]]">
          <CalendarStageIcon :stage="stage" />{{ stageLabel(stage) }}
        </span>
      </div>
    </div>
    <!-- The icons a block draws, in the colours it draws them: the € dot in
         particular says nothing on its own, and week view shows it instead
         of the amount. -->
    <ul class="mt-3 space-y-1.5 text-ink-600" data-cy="calendar-icon-key">
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center"><span class="flex h-[13px] w-[13px] items-center justify-center rounded-full bg-danger-text text-[11px] font-bold text-danger-on" aria-hidden="true">€</span></span>
        {{ t('Owes money (the whole balance)', 'Debe dinero (todo su saldo)') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-ink-500"><CalendarBlockIcon kind="noNext" /></span>
        {{ t('No next visit booked', 'Sin próxima cita reservada') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-danger-text"><CalendarRedFlagIcon :label="t('Red flags', 'Señales rojas')" /></span>
        {{ t('Red flags on the record', 'Señales rojas en la ficha') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-brand-text"><CalendarVisitMarkerIcon /></span>
        {{ t('Care plan re-exam', 'Revisión del plan de tratamiento') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-warning-text"><CalendarBlockIcon kind="forms" /></span>
        {{ t('Forms not completed', 'Formularios sin completar') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-warning-accent"><CalendarBlockIcon kind="note" /></span>
        {{ t('Clinical note', 'Nota clínica') }}
      </li>
      <li class="flex items-center gap-2">
        <span class="flex w-4 shrink-0 justify-center text-ink-muted"><CalendarBlockIcon kind="moved" /></span>
        {{ t('Moved before (times)', 'Movida antes (veces)') }}
      </li>
    </ul>
  </div>
</template>
