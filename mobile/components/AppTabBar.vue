<script setup lang="ts">
// The list itself lives in composables/useAppNav.ts, shared with the iPad
// side menu; this bar is the phone's, hidden from md up by the layout.
const { items, isActive } = useStaffNav()
// Profile stays in the iPad's side menu; on a phone it is the avatar on My Day.
const tabs = computed(() => items.value.filter((x) => x.inTabBar !== false))
const t = useT()
</script>

<template>
  <!-- The floating bar (assets/css/main.css, "three planes"): a capsule over
       the sheet, the current tab a pill inside it. In the flow rather than
       fixed over the content, so no screen has to pad its own bottom for it. -->
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
        <span class="relative">
          <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(tab.to) ? 1.6 : 1.3" aria-hidden="true">
            <path :d="tab.icon" />
          </svg>
          <span v-if="tab.badge" class="absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger-text px-1 text-[11px] font-bold leading-none text-danger-on" data-cy="nav-badge">{{ tab.badge > 99 ? '99+' : tab.badge }}</span>
        </span>
        <span class="max-w-full truncate px-0.5">{{ tab.label }}</span><span v-if="tab.badge" class="sr-only">, {{ tab.badge }} {{ t('unread', 'sin leer') }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
