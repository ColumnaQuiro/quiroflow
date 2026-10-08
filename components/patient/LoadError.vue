<script setup lang="ts">
// A list that failed to load, said as such -- not "nothing here yet", which
// is what a patient offline used to be told about their own visits.
const emit = defineEmits<{ retry: [] }>()
const t = useT()
</script>

<template>
  <div class="px-4 py-8 text-center" role="alert" data-cy="patient-load-error">
    <p class="text-[13px] text-ink-muted">{{ t("Couldn't load this. Check your connection.", 'No se ha podido cargar. Revisa tu conexión.') }}</p>
    <button type="button" class="mt-2 text-[13px] font-semibold text-brand-text" @click="emit('retry')">{{ t('Try again', 'Reintentar') }}</button>
  </div>
</template>
