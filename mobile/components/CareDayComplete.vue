<script setup lang="ts">
// "Día completo": shown once a day on Cuidarme, when the last exercise or
// habit reminder due today is ticked (pages/care/index.vue decides). A short
// well-done and the streak, nothing to do but close it. Never shown for a day
// that did not get there: no guilt, by design.
defineProps<{ streak: number; weekDone: number }>()
const emit = defineEmits<{ close: [] }>()
const t = useT()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-ink-900/45" data-cy="care-day-complete" @click.self="emit('close')">
    <div class="flex w-full flex-col items-center gap-4 rounded-t-[22px] bg-surface px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-6 text-center" role="dialog" aria-modal="true" :aria-label="t('Day complete', 'Día completo')">
      <span class="flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12l5 5L20 7" /></svg>
      </span>
      <div>
        <p class="text-[22px] font-bold text-ink-900">{{ t('Day complete', 'Día completo') }}</p>
        <p class="mt-1 text-[15px] text-ink-700">{{ t("Today's exercises and habits, done.", 'Ejercicios y hábitos de hoy, hechos.') }}</p>
      </div>
      <div class="grid w-full grid-cols-2 gap-2.5">
        <div class="rounded-card border border-line p-3"><p class="font-mono text-[20px] text-ink-900">{{ streak }}</p><p class="text-[12.5px] text-ink-muted">{{ t('days in a row', 'días seguidos') }}</p></div>
        <div class="rounded-card border border-line p-3"><p class="font-mono text-[20px] text-ink-900">{{ weekDone }}/7</p><p class="text-[12.5px] text-ink-muted">{{ t('this week', 'esta semana') }}</p></div>
      </div>
      <p class="text-[12.5px] text-ink-muted">{{ t('Your practitioner will see it at your next visit.', 'Tu profesional lo verá en tu próxima visita.') }}</p>
      <button type="button" class="h-12 w-full rounded-card bg-brand text-[15px] font-bold text-white" data-cy="care-day-complete-close" @click="emit('close')">{{ t('Carry on', 'Seguir') }}</button>
    </div>
  </div>
</template>
