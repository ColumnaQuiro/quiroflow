<script setup lang="ts">
// The exercise library moved to the Exercises section (pages/exercises),
// with its own permission, exercises_manage. Bookmarks and old links land
// on the same tab there.
const route = useRoute()
await navigateTo({ path: '/exercises', query: { ...route.query, section: 'library' } }, { replace: true })
</script>

<template>
  <div />
</template>
