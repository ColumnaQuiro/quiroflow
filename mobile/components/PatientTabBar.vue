<script setup lang="ts">
// Patients didn't get tabs: the whole app was one scrolling home screen
// with every section stacked on it and a single link out to Messages. Same
// five destinations as the web portal (layouts/portal.vue), so a patient
// who uses both finds the same things in the same order.
const route = useRoute()
const t = useT()

const tabs = computed(() => [
  { label: t('Home', 'Inicio'), to: '/', icon: 'M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z' },
  { label: t('Visits', 'Citas'), to: '/visits', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
  { label: t('Billing', 'Pagos'), to: '/billing', icon: 'M2 4h12v8h-12zM2 7h12' },
  { label: t('Files', 'Archivos'), to: '/documents', icon: 'M4 2h5l3 3v9H4zM9 2v3.2h3' },
  { label: t('Messages', 'Mensajes'), to: '/messages', icon: 'M2 3.5h12v8h-7l-3 2.5v-2.5h-2z' },
])

// Home is an exact match -- every other path starts with '/', so a prefix
// test would light it up on every tab.
function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
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
