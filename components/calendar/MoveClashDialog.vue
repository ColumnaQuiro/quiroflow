<script setup lang="ts">
import { formatTime } from '~/utils/billing'
import type { MoveClash } from '~/utils/moveClash'

// "That time is blocked": the blocked time a move, resize or change of time
// would land in, before it is saved. Another patient at the same time is not
// asked about (utils/moveClash says why). Going back is the default, moving
// it into the block anyway is possible but has to be asked for.

defineProps<{ clashes: MoveClash[]; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const t = useT()

function line(c: MoveClash) {
  return { what: c.note ? t(`Blocked: ${c.note}`, `Bloqueado: ${c.note}`) : t('Blocked time', 'Tiempo bloqueado'), when: `${formatTime(c.startsAt)}–${formatTime(c.endsAt)}` }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('That time is blocked', 'Ese hueco está bloqueado')"
    :confirm-label="t('Move it anyway', 'Moverla igualmente')"
    :cancel-label="t('Choose another time', 'Elegir otra hora')"
    :busy="busy"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <div data-cy="move-clash" class="flex flex-col gap-2 text-[14px] leading-relaxed text-ink-500">
      <p>{{ t('The new time falls in:', 'La nueva hora cae en:') }}</p>
      <ul class="flex flex-col gap-1.5 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px]">
        <li v-for="(c, i) in clashes" :key="i" class="flex items-baseline justify-between gap-3" data-cy="move-clash-item">
          <span class="font-semibold text-warning-text">{{ line(c).what }}</span>
          <span class="shrink-0 font-mono text-ink-700">{{ line(c).when }}</span>
        </li>
      </ul>
      <p>{{ t('Moving it anyway keeps the visit inside the blocked time. The block is not changed.', 'Si la mueves igualmente, la cita queda dentro del bloqueo. El bloqueo no se cambia.') }}</p>
    </div>
  </UiConfirmDialog>
</template>
