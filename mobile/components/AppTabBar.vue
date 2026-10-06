<script setup lang="ts">
// The list itself lives in composables/useAppNav.ts, shared with the iPad
// side menu; this bar is the phone's, hidden from md up by the layout.
const { items: tabs, isActive } = useStaffNav()
const t = useT()
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
      :class="isActive(tab.to) ? 'text-brand-text' : 'text-ink-muted'"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
    >
      <span class="relative">
        <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(tab.to) ? 1.6 : 1.3">
          <path :d="tab.icon" />
        </svg>
        <span v-if="tab.badge" class="absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger-text px-1 text-[10.5px] font-bold leading-none text-white" data-cy="nav-badge">{{ tab.badge > 99 ? '99+' : tab.badge }}</span>
      </span>
      {{ tab.label }}<span v-if="tab.badge" class="sr-only">, {{ tab.badge }} {{ t('unread', 'sin leer') }}</span>
    </NuxtLink>
  </nav>
</template>
