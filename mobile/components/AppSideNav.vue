<script setup lang="ts">
// The iPad's navigation: a side menu where the phone has its bottom tab bar
// (layouts/practitioner.vue and layouts/patient.vue show one or the other by
// width, in CSS). Same sections, from composables/useAppNav.ts.
import type { AppNavItem } from '../composables/useAppNav'

defineProps<{ items: AppNavItem[]; isActive: (to: string) => boolean; title: string; subtitle?: string }>()
const t = useT()
</script>

<template>
  <nav
    class="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface px-3 pt-4 lg:w-[236px]"
    style="padding-bottom: max(env(safe-area-inset-bottom), 1rem); padding-left: max(env(safe-area-inset-left), 0.75rem)"
    data-test="app-side-nav"
  >
    <div class="mb-3 flex items-center gap-2.5 px-2 pb-1">
      <img src="/logo/quiroflow-mark.svg" alt="" class="h-7 w-7" />
      <div class="min-w-0">
        <p class="truncate text-[14px] font-semibold text-ink-900">{{ title }}</p>
        <p v-if="subtitle" class="truncate text-[11.5px] text-ink-muted">{{ subtitle }}</p>
      </div>
    </div>
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="flex h-10 items-center gap-2.5 rounded-ctl px-2.5 text-[14px]"
      :class="isActive(item.to) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-700 active:bg-surface-subtle'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="isActive(item.to) ? 1.6 : 1.3" stroke-linejoin="round" aria-hidden="true">
        <path :d="item.icon" />
      </svg>
      <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
      <span v-if="item.badge" class="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-danger-text px-1.5 text-[11px] font-bold text-white" data-cy="nav-badge">{{ item.badge > 99 ? '99+' : item.badge }}<span class="sr-only">&nbsp;{{ t('unread', 'sin leer') }}</span></span>
    </NuxtLink>
    <div class="flex-1" />
    <slot name="footer" />
  </nav>
</template>
