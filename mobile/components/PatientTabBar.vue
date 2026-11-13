<script setup lang="ts">
// Patients didn't get tabs: the whole app was one scrolling home screen
// with every section stacked on it and a single link out to Messages. Same
// five destinations as the web portal (layouts/portal.vue), so a patient
// who uses both finds the same things in the same order.
// The list itself lives in composables/useAppNav.ts, shared with the iPad
// side menu; this bar is the phone's, hidden from md up by the layout.
const { items, isActive } = usePatientNav()
// Five fit; the rest (Documentos) is in the iPad's side menu only.
const tabs = computed(() => items.value.filter((x) => x.inTabBar !== false))
</script>

<template>
  <!-- The floating bar, as on the staff side (components/AppTabBar.vue). -->
  <div class="shrink-0 bg-surface-page px-3 pt-1.5" style="padding-bottom: max(env(safe-area-inset-bottom), 0.75rem)">
    <nav class="flex h-[62px] rounded-full bg-surface p-1.5 shadow-float">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold"
        :class="isActive(tab.to) ? 'bg-brand-tint text-brand-text' : 'text-ink-muted active:bg-surface-subtle'"
        :aria-current="isActive(tab.to) ? 'page' : undefined"
      >
        <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(tab.to) ? 1.6 : 1.3" stroke-linejoin="round" aria-hidden="true">
          <path :d="tab.icon" />
        </svg>
        <span class="max-w-full truncate px-0.5">{{ tab.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
