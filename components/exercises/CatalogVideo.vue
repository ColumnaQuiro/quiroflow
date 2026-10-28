<script setup lang="ts">
// A catalogue exercise's demonstration (useExerciseCatalog): a short looping
// animation, with its poster until it is played. Nothing loads until then,
// unless it is opened to play straight away.
const props = defineProps<{ slug: string; label?: string; autoplay?: boolean }>()
const catalog = useExerciseCatalog()
const src = computed(() => catalog.media(props.slug))
</script>

<template>
  <video
    :src="src.video"
    :poster="src.poster"
    :aria-label="label"
    :autoplay="autoplay"
    controls
    loop
    muted
    playsinline
    :preload="autoplay ? 'auto' : 'none'"
    class="aspect-video w-full rounded-ctl bg-surface-subtle object-contain"
    data-cy="catalog-video"
  />
</template>
