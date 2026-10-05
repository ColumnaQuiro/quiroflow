<script setup lang="ts">
// Patients didn't get tabs: the whole app was one scrolling home screen
// with every section stacked on it and a single link out to Messages. Same
// five destinations as the web portal (layouts/portal.vue), so a patient
// who uses both finds the same things in the same order.
// The list itself lives in composables/useAppNav.ts, shared with the iPad
// side menu; this bar is the phone's, hidden from md up by the layout.
const { items: tabs, isActive } = usePatientNav()
</script>

<template>
  <nav class="flex shrink-0 border-t border-line bg-surface" style="padding-bottom: max(env(safe-area-inset-bottom), 0.5rem)">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="flex flex-1 flex-col items-center gap-1 pt-2 text-[10.5px] font-medium"
      :class="isActive(tab.to) ? 'text-brand-text' : 'text-ink-faint'"
    >
      <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(tab.to) ? 1.6 : 1.3" stroke-linejoin="round">
        <path :d="tab.icon" />
      </svg>
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
