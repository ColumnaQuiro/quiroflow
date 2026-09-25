<script setup lang="ts">
import type { AppointmentStage } from '~/utils/appointmentStage'
import { FILTER_DOT_CLASS } from '~/composables/useAppointmentStage'

// Who is in the building right now, and the one step each of them needs
// next. The columns are stages from utils/appointmentStage -- not the raw
// flow timestamps -- so a person here is always in the same place as their
// block on the grid and their track in the appointment panel.

export interface FlowRow {
  id: string
  name: string
  stage: AppointmentStage
  /** "llegó 17:36 · cita 18:00", "desde 17:22 · Marta", "debe 40,00 €". */
  sub: string
}

const props = defineProps<{ rows: FlowRow[]; privacy?: boolean }>()
const emit = defineEmits<{ advance: [id: string]; open: [id: string] }>()
const t = useT()

const columns = computed(() => {
  const of = (stage: AppointmentStage) => props.rows.filter((r) => r.stage === stage)
  return [
    { key: 'arrived' as const, title: t('Arrived', 'Llegados'), rows: of('arrived'), action: t('Into session', 'Pasa a consulta'), glyph: '→' },
    { key: 'withp' as const, title: t('In session', 'En consulta'), rows: of('withp'), action: t('To checkout', 'Pasar a cobro'), glyph: '→' },
    { key: 'checkout' as const, title: t('To pay', 'Por cobrar'), rows: of('checkout'), action: t('Charge', 'Cobrar'), glyph: null },
  ]
})
</script>

<template>
  <div class="space-y-3">
    <section v-for="col in columns" :key="col.key" :data-cy="`flow-${col.key}`" class="rounded-card border border-line bg-surface p-2.5">
      <div class="flex items-center gap-1.5 px-0.5">
        <span class="h-2 w-2 shrink-0 rounded-full" :class="FILTER_DOT_CLASS[col.key]" aria-hidden="true" />
        <h3 class="grow text-[12.5px] font-[640] text-ink-700">{{ col.title }}</h3>
        <span data-cy="flow-count" class="rounded-pill bg-chip-bg px-1.5 py-0.5 text-[11px] font-medium text-chip-text">{{ col.rows.length }}</span>
      </div>
      <ul class="mt-2 space-y-1.5">
        <li v-for="r in col.rows" :key="r.id" data-cy="flow-row" :data-appointment-id="r.id" class="flex items-stretch overflow-hidden rounded-ctlSm border border-line-row">
          <button type="button" data-cy="flow-open" class="min-w-0 grow px-2 py-1.5 text-left hover:bg-surface-subtle" @click="emit('open', r.id)">
            <span class="block truncate text-[13px] font-medium text-ink-700" :class="{ 'select-none blur-sm': privacy }">{{ r.name }}</span>
            <span class="block text-[11.5px] leading-snug text-ink-muted">{{ r.sub }}</span>
          </button>
          <button
            type="button"
            data-cy="flow-advance"
            :aria-label="`${col.action}: ${privacy ? '' : r.name}`"
            :title="col.action"
            class="flex min-h-9 touch:min-h-11 min-w-9 touch:min-w-11 shrink-0 items-center justify-center border-l border-line-row px-2 text-[12.5px] font-semibold hover:bg-surface-subtle"
            :class="col.glyph ? 'text-brand-text' : 'text-success-text'"
            @click="emit('advance', r.id)"
          >
            {{ col.glyph ?? col.action }}
          </button>
        </li>
      </ul>
      <p v-if="col.rows.length === 0" class="mt-1.5 px-0.5 text-[12px] text-ink-faint">—</p>
    </section>
  </div>
</template>
