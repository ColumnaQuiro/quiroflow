<script setup lang="ts">
const props = defineProps<{ rating: number; size?: number }>()

const t = useT()

// Drawn from the number rather than printed as "★★★★☆", so the value stays
// comparable and the label below stays true when the rating changes. Drawn
// as an icon, too: the ★ character came out of whichever font had it --
// sized and baselined differently per platform, and on some an emoji.
const stars = computed(() => [1, 2, 3, 4, 5].map((n) => n <= Math.round(props.rating)))
const px = computed(() => props.size ?? 11)
</script>

<template>
  <span class="inline-flex items-center gap-px leading-none" role="img" :aria-label="`${rating} ${t('out of 5', 'de 5')}`">
    <svg
      v-for="(filled, i) in stars"
      :key="i"
      viewBox="0 0 20 20"
      aria-hidden="true"
      class="shrink-0"
      :class="filled ? 'text-warning-accent' : 'text-ink-faint3'"
      :width="px"
      :height="px"
    >
      <path fill="currentColor" d="M10 1.8l2.45 5.12 5.6.68-4.13 3.84 1.07 5.55L10 14.27l-4.99 2.72 1.07-5.55L1.95 7.6l5.6-.68L10 1.8z" />
    </svg>
  </span>
</template>
