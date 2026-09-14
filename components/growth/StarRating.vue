<script setup lang="ts">
const props = defineProps<{ rating: number; size?: number }>()

const t = useT()

// Drawn from the number rather than printed as "★★★★☆", so the value stays
// comparable and the label below stays true when the rating changes.
const stars = computed(() => [1, 2, 3, 4, 5].map((n) => n <= Math.round(props.rating)))
const px = computed(() => props.size ?? 11)
</script>

<template>
  <span class="inline-flex items-center gap-px leading-none" role="img" :aria-label="`${rating} ${t('out of 5', 'de 5')}`">
    <span
      v-for="(filled, i) in stars"
      :key="i"
      aria-hidden="true"
      :class="filled ? 'text-warning-accent' : 'text-ink-faint3'"
      :style="{ fontSize: `${px}px` }"
    >★</span>
  </span>
</template>
