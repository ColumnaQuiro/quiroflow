<script setup lang="ts">
defineProps<{ label: string }>()

const t = useT()
</script>

<template>
  <div class="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
    {{ t(`${label} import isn't built yet.`, `La importación de ${label} aún no está disponible.`) }}
  </div>
</template>
