<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'My Day', to: '/my-day', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4' },
  { label: 'Calendar', to: '/calendar', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
  { label: 'Patients', to: '/patients', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
  { label: 'Inbox', to: '/inbox', icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z' },
  { label: 'Profile', to: '/profile', icon: 'M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM3.2 13.4c0-2.3 2.1-3.6 4.8-3.6s4.8 1.3 4.8 3.6' },
]

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav
    class="flex shrink-0 border-t border-line bg-surface"
    style="padding-bottom: max(env(safe-area-inset-bottom), 0.5rem)"
  >
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="flex flex-1 flex-col items-center gap-1 pt-2 text-[10.5px] font-medium"
      :class="isActive(tab.to) ? 'text-brand-text' : 'text-ink-faint'"
    >
      <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(tab.to) ? 1.6 : 1.3">
        <path :d="tab.icon" />
      </svg>
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
