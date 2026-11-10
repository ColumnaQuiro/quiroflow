<script setup lang="ts">
// Shown wherever a step is about to read PracticeHub, once an earlier step
// has: the lists it would read again are reused for a while
// (utils/practicehubReadCache), and a clinic that has just corrected a record
// in PracticeHub can ask for a fresh read instead.
const t = useT()
const reads = usePracticeHubReads()
</script>

<template>
  <p v-if="reads.held.value" class="text-[12.5px] text-ink-muted2" data-cy="ph-reads-held">
    {{ t('Lists read by an earlier step in the last few minutes are reused, so this one starts sooner.', 'Las listas que un paso anterior leyó en los últimos minutos se reutilizan, así que este empieza antes.') }}
    <button type="button" class="font-medium text-brand-text hover:underline" data-cy="ph-reads-forget" @click="reads.forget()">
      {{ t('Read PracticeHub afresh', 'Volver a leer PracticeHub') }}
    </button>
  </p>
</template>
