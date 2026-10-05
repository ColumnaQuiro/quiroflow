<script setup lang="ts">
// Registered once here (not per-tab) so switching between My Day/Calendar/
// Patients/Inbox doesn't re-register a push token on every navigation.
const { register: registerForPush } = usePushNotifications()
onMounted(registerForPush)

// Hidden (not just covered) while the keyboard is up: with it gone, the
// page's slot fills the tab bar's space too, so a page like Inbox that pads
// its own bottom by the keyboard height (see PractitionerInbox.vue) lands
// its composer flush against the keyboard instead of leaving a tab-bar-sized
// gap above it.
const { keyboardHeight } = useKeyboardInset()

// On an iPad (md and up) the sections are a side menu instead of the tab bar.
// Chosen in CSS, so the phone is untouched and nothing swaps on load.
const { items, isActive } = useStaffNav()
const { context } = usePractitionerContext()
const t = useT()
const initials = computed(() => (context.value?.fullName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col md:flex-row">
    <AppSideNav class="hidden md:flex" :items="items" :is-active="isActive" title="QuiroFlow" :subtitle="t('Clinic team', 'Equipo de la clínica')">
      <template #footer>
        <NuxtLink v-if="context" to="/profile" class="flex items-center gap-2.5 rounded-ctl px-2 py-2 active:bg-surface-subtle">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11.5px] font-bold text-brand-text">{{ initials }}</span>
          <span class="min-w-0 truncate text-[13px] font-medium text-ink-900">{{ context.fullName }}</span>
        </NuxtLink>
      </template>
    </AppSideNav>
    <div class="min-h-0 min-w-0 flex-1">
      <slot />
    </div>
    <AppTabBar v-if="keyboardHeight === 0" class="md:hidden" />
  </div>
</template>
