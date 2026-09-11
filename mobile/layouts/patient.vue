<script setup lang="ts">
// The patient side of the app, with tabs. Mirrors layouts/practitioner.vue,
// including why the bar disappears rather than hides when the keyboard is
// up: a page that pads its own bottom by the keyboard height (the message
// composer) would otherwise land a tab-bar-sized gap above it.
const { keyboardHeight } = useKeyboardInset()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </div>
    <PatientTabBar v-if="keyboardHeight === 0" />
  </div>
</template>
