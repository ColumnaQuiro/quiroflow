<script setup lang="ts">
// Placeholder rows for a report table whose header is already on screen, so
// the columns are known while the rows are still loading.
withDefaults(defineProps<{ cols: number; rows?: number }>(), { rows: 5 })
</script>

<template>
  <tr v-for="r in rows" :key="r" aria-hidden="true">
    <td v-for="c in cols" :key="c" class="px-4 py-3">
      <UiSkeleton class="h-3.5 rounded-ctlSm" :style="{ width: `${45 + ((r * 7 + c * 13) % 40)}%` }" />
    </td>
  </tr>
</template>
