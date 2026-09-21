<script setup lang="ts">
// A filled bar. Deliberately has no "over the limit" tone: the only two
// things metered here are seats and storage, and storage is headroom rather
// than a gate -- turning it red would promise a block that never happens.
withDefaults(defineProps<{ percent: number | null; tone?: 'brand' | 'info' | 'success' }>(), { tone: 'brand' })

const FILL = { brand: 'bg-brand', info: 'bg-info-accent', success: 'bg-success-accent' }
</script>

<template>
  <div v-if="percent !== null" class="h-[5px] overflow-hidden rounded-[3px] bg-line-divider">
    <div class="h-[5px] rounded-[3px]" :class="FILL[tone]" :style="{ width: `${percent}%` }" />
  </div>
</template>
