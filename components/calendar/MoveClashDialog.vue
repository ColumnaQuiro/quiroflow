<script setup lang="ts">
import { formatTime } from '~/utils/billing'
import type { MoveClash } from '~/utils/moveClash'

// "That time is taken": what a move, resize or change of time would land on,
// before it is saved. The same choice the create panel's "allow double
// booking" gives a new booking -- going back is the default, moving it on
// top anyway is possible but has to be asked for.

defineProps<{ clashes: MoveClash[]; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const t = useT()

function line(c: MoveClash) {
  const when = `${formatTime(c.startsAt)}–${formatTime(c.endsAt)}`
  if (c.kind === 'block') return { what: c.note ? t(`Blocked: ${c.note}`, `Bloqueado: ${c.note}`) : t('Blocked time', 'Tiempo bloqueado'), when }
  const name = c.patientName || t('Another patient', 'Otro paciente')
  return { what: c.via === 'room' ? t(`${name} (same room)`, `${name} (misma sala)`) : name, when }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('That time is taken', 'Ese hueco está ocupado')"
    :confirm-label="t('Move it anyway', 'Moverla igualmente')"
    :cancel-label="t('Choose another time', 'Elegir otra hora')"
    :busy="busy"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <div data-cy="move-clash" class="flex flex-col gap-2 text-[14px] leading-relaxed text-ink-500">
      <p>{{ t('The new time overlaps:', 'La nueva hora coincide con:') }}</p>
      <ul class="flex flex-col gap-1.5 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px]">
        <li v-for="(c, i) in clashes" :key="i" class="flex items-baseline justify-between gap-3" data-cy="move-clash-item">
          <span class="font-semibold text-warning-text">{{ line(c).what }}</span>
          <span class="shrink-0 font-mono text-ink-700">{{ line(c).when }}</span>
        </li>
      </ul>
      <p>{{ t('Two at once is possible, but only on purpose.', 'Dos a la vez es posible, pero solo a propósito.') }}</p>
    </div>
  </UiConfirmDialog>
</template>
