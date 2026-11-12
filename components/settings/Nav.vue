<script setup lang="ts">
const route = useRoute()
const t = useT()

const { groups } = useSettingsNavItems()

// A section stays lit on its own detail pages -- Clinics on
// /settings/clinics/<id>, Roles on /settings/roles/<id>.
function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

// This component is embedded identically at the top of ~29 settings pages
// (see the `flex-1` sibling right after <SettingsNav /> in each one), none
// of which have their own place to host a menu button -- fixed positioning
// means the mobile trigger/drawer don't depend on whatever flex/grid
// context the page around them happens to use, so this is a one-file fix
// rather than 29 page edits. Closes on navigation, same as AppSidebar's
// own mobile drawer.
const mobileOpen = ref(false)
watch(() => route.fullPath, () => (mobileOpen.value = false))
// Escape closes the drawer, as it does every other overlay in the app.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && mobileOpen.value) mobileOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <button
    v-if="!mobileOpen"
    type="button"
    class="fixed bottom-6 left-4 z-30 flex h-9 touch:h-11 items-center gap-2 rounded-pill border border-line bg-surface px-4 text-[13px] font-medium text-ink-700 shadow-popover print:hidden lg:hidden"
    aria-controls="settings-sections"
    :aria-expanded="mobileOpen"
    @click="mobileOpen = true"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M1.5 3.5h11M1.5 7h11M1.5 10.5h11" /></svg>
    {{ t('Sections', 'Secciones') }}
  </button>

  <div v-if="mobileOpen" class="fixed inset-0 z-40 bg-scrim/40 lg:hidden" @click="mobileOpen = false" />

  <nav
    id="settings-sections"
    :aria-label="t('Settings sections', 'Secciones de ajustes')"
    class="fixed inset-y-0 left-0 z-50 w-[280px] space-y-5 overflow-y-auto bg-surface-sidebar p-3 transition-transform duration-200 print:hidden lg:static lg:z-auto lg:w-[220px] lg:shrink-0 lg:translate-x-0 lg:shadow-none"
    :class="mobileOpen ? 'translate-x-0 shadow-popover' : '-translate-x-full'"
  >
    <div class="flex items-center justify-between lg:block">
      <NuxtLink to="/settings" class="block px-2 text-[13px] font-semibold text-ink-900 hover:text-brand"> {{ t('Settings', 'Ajustes') }} </NuxtLink>
      <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-sidebarHover lg:hidden touch:h-11 touch:w-11" :aria-label="t('Close sections', 'Cerrar secciones')" @click="mobileOpen = false">
        <UiCloseIcon class="!h-3.5 !w-3.5" />
      </button>
    </div>
    <div v-for="group in groups" :key="group.label">
      <p class="px-2 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ group.label }}</p>
      <div class="mt-1 space-y-0.5">
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="flex h-8 items-center rounded-ctlSm px-2 text-[13px] touch:h-11"
          :class="isActive(item.to) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-600 hover:bg-surface-sidebarHover'"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
