<script setup lang="ts">
// Loading, drawn as the rows that are coming (as My Day does) rather than a
// bare "Loading…": the screen keeps its shape and nothing jumps when the data
// lands. `avatar` for people lists, `rows` for how many.
withDefaults(defineProps<{ rows?: number; avatar?: boolean }>(), { rows: 5, avatar: false })
const t = useT()
</script>

<template>
  <div class="flex flex-col gap-2.5 px-4 py-4" role="status" aria-busy="true">
    <span class="sr-only">{{ t('Loading…', 'Cargando…') }}</span>
    <div v-for="i in rows" :key="i" class="flex items-center gap-3">
      <UiSkeleton v-if="avatar" class="h-10 w-10 shrink-0 rounded-full" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <UiSkeleton class="h-3.5 rounded-ctlSm" :class="i % 2 ? 'w-2/3' : 'w-1/2'" />
        <UiSkeleton class="h-3 w-1/3 rounded-ctlSm" />
      </div>
    </div>
  </div>
</template>
