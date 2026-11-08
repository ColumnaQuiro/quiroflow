<script setup lang="ts">
import type { WidgetSize } from '~/utils/dashboardWidgets'
import { SIZE_COL_SPAN } from '~/utils/dashboardWidgets'

const props = defineProps<{ title: string; meta?: string; size: WidgetSize; editing: boolean; index: number; isFirst?: boolean; isLast?: boolean }>()
const emit = defineEmits<{
  remove: []
  cycleSize: []
  move: [delta: -1 | 1]
  dragStart: [index: number]
  dragOver: [index: number]
}>()

const t = useT()

// A widget whose read fails used to sit on its skeleton for good: every
// widget sets `loading` back to false only after its query succeeds, and
// fetchAllRows throws supabase's error. So a failed load looked exactly like
// a slow one, forever. Vue hands a child's failed lifecycle hook or watcher
// to errorCaptured here, so one frame covers all fifteen widgets. Nothing is
// returned, so the error still travels on to the app's handler (Sentry).
const failed = ref(false)
const attempt = ref(0)
onErrorCaptured(() => {
  failed.value = true
})
function retry() {
  failed.value = false
  attempt.value++
}

const SIZE_LABEL: Record<WidgetSize, [string, string]> = {
  sm: ['Narrow', 'Estrecho'],
  md: ['Wide', 'Ancho'],
  lg: ['Full width', 'Completo'],
}
</script>

<template>
  <div
    class="relative rounded-card border bg-surface p-4 shadow-card"
    :class="[SIZE_COL_SPAN[props.size], editing ? 'border-brand-tintBorder' : 'border-line']"
    :draggable="editing"
    @dragstart="emit('dragStart', index)"
    @dragover.prevent="emit('dragOver', index)"
  >
    <!-- Wraps: at a third of the width the edit controls would otherwise
         squeeze the title down to its first letter. -->
    <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
      <div class="flex flex-1 items-center gap-1.5" :class="editing ? 'min-w-[9rem]' : 'min-w-0'">
        <span v-if="editing" class="-ml-1 flex shrink-0 cursor-move text-ink-faint2" :title="t('Drag to reorder', 'Arrastra para reordenar')" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4">
            <circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" />
            <circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" />
            <circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" />
          </svg>
        </span>
        <h2 class="truncate text-[13px] font-semibold text-ink-900">{{ title }}</h2>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <span v-if="meta && !editing" class="text-[11.5px] text-ink-muted2">{{ meta }}</span>
        <template v-if="editing">
          <!-- Dragging is mouse-only, so the arrows are the way to reorder
               from a keyboard or on the front-desk iPad. -->
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40 touch:h-10 touch:w-10"
            :aria-label="t('Move earlier', 'Mover antes')"
            :title="t('Move earlier', 'Mover antes')"
            :disabled="isFirst"
            data-cy="widget-move-earlier"
            @click="emit('move', -1)"
          >
            <UiChevron dir="left" />
          </button>
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40 touch:h-10 touch:w-10"
            :aria-label="t('Move later', 'Mover después')"
            :title="t('Move later', 'Mover después')"
            :disabled="isLast"
            data-cy="widget-move-later"
            @click="emit('move', 1)"
          >
            <UiChevron dir="right" />
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-ctlSm border border-line-control px-2 text-[11.5px] font-medium text-ink-muted2 hover:border-line-controlHover hover:text-ink-600 touch:h-10"
            :title="t('Change the widget width', 'Cambiar el ancho del widget')"
            data-cy="widget-cycle-size"
            @click="emit('cycleSize')"
          >
            {{ t(...SIZE_LABEL[size]) }}
          </button>
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-danger-bg hover:text-danger-text touch:h-10 touch:w-10"
            :aria-label="t('Remove widget', 'Eliminar widget')"
            :title="t('Remove widget', 'Eliminar widget')"
            data-cy="widget-remove"
            @click="emit('remove')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </template>
      </div>
    </div>
    <div class="mt-3" :class="{ 'pointer-events-none opacity-60': editing }">
      <div v-if="failed" role="alert" class="flex flex-wrap items-center gap-x-3 gap-y-2" data-cy="widget-error">
        <p class="text-[12.5px] text-danger-text">{{ t("Couldn't load this widget.", 'No se ha podido cargar este widget.') }}</p>
        <UiBtn size="sm" @click="retry">{{ t('Try again', 'Reintentar') }}</UiBtn>
      </div>
      <div v-else :key="attempt">
        <slot />
      </div>
    </div>
  </div>
</template>
