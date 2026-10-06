<script setup lang="ts">
// Draws useAppConfirm's question: a bottom sheet on a phone, a centred dialog
// on an iPad, as the other sheets.
const { current, answer } = useAppConfirm()
const t = useT()
</script>

<template>
  <div v-if="current" class="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="app-confirm" @click.self="answer(false)">
    <div
      class="flex w-full flex-col gap-3 rounded-t-[22px] bg-surface px-4 pt-4 shadow-popover md:max-w-[420px] md:rounded-[18px]"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="alertdialog"
      aria-modal="true"
      :aria-label="current.title"
    >
      <p class="text-[17px] font-semibold leading-snug text-ink-900">{{ current.title }}</p>
      <p v-if="current.body" class="-mt-1 whitespace-pre-line text-[14px] leading-relaxed text-ink-muted">{{ current.body }}</p>
      <button
        type="button"
        class="mt-1 flex h-11 items-center justify-center rounded-card text-[15px] font-semibold text-white"
        :class="current.danger ? 'bg-danger-text' : 'bg-brand'"
        data-cy="app-confirm-ok"
        @click="answer(true)"
      >
        {{ current.confirmLabel }}
      </button>
      <button v-if="current.cancelLabel" type="button" class="flex min-h-11 items-center justify-center text-[14px] text-ink-muted" data-cy="app-confirm-cancel" @click="answer(false)">
        {{ current.cancelLabel || t('Cancel', 'Cancelar') }}
      </button>
    </div>
  </div>
</template>
