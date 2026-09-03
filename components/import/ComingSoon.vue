<script setup lang="ts">
defineProps<{ label: string }>()

const t = useT()
</script>

<template>
  <div class="rounded-lg border border-dashed border-line-control bg-surface p-8 text-center text-sm text-ink-faint">
    {{ t(`${label} import isn't built yet.`, `La importación de ${label} aún no está disponible.`) }}
  </div>
</template>
