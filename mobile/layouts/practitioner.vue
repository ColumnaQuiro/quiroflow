<script setup lang="ts">
// Registered once here (not per-tab) so switching between My Day/Calendar/
// Patients/Inbox doesn't re-register a push token on every navigation.
const { register: registerForPush } = usePushNotifications()
onMounted(registerForPush)
// The Inbox tab's unread count, kept current from here for the whole app.
const { start: startInboxBadge } = useInboxUnread()
onMounted(startInboxBadge)

// Hidden (not just covered) while the keyboard is up: with it gone, the
// page's slot fills the tab bar's space too, so a page like Inbox that pads
// its own bottom by the keyboard height (see PractitionerInbox.vue) lands
// its composer flush against the keyboard instead of leaving a tab-bar-sized
// gap above it.
const { keyboardHeight } = useKeyboardInset()

// On an iPad (md and up) the sections are a side menu instead of the tab bar.
// Chosen in CSS, so the phone is untouched and nothing swaps on load.
const { items, isActive } = useStaffNav()
const { context, loadFailed, retry, clinics } = usePractitionerContext()
// With more than one location, the side menu names the one the app is in.
const clinicName = computed(() => (clinics.value.length > 1 ? clinics.value.find((c) => c.id === context.value?.clinicId)?.name : null))
const t = useT()
const initials = computed(() => (context.value?.fullName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col md:flex-row">
    <AppSideNav class="hidden md:flex" :items="items" :is-active="isActive" title="QuiroFlow" :subtitle="clinicName ?? t('Clinic team', 'Equipo de la clínica')">
      <template #footer>
        <NuxtLink v-if="context" to="/profile" class="flex items-center gap-2.5 rounded-ctl px-2 py-2 active:bg-surface-subtle">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11.5px] font-bold text-brand-text">{{ initials }}</span>
          <span class="min-w-0 truncate text-[13px] font-medium text-ink-900">{{ context.fullName }}</span>
        </NuxtLink>
      </template>
    </AppSideNav>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- The team record or the role could not be read: say so, instead of
           screens that look empty because nothing loaded. -->
      <div v-if="loadFailed" class="flex shrink-0 items-center gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-[13px] text-warning-text" role="status" data-cy="context-load-failed">
        <span class="min-w-0 flex-1">{{ t('Could not reach the clinic. Trying again…', 'No se ha podido conectar con la clínica. Reintentando…') }}</span>
        <button type="button" class="h-9 shrink-0 rounded-ctl px-2 font-semibold" @click="retry">{{ t('Retry', 'Reintentar') }}</button>
      </div>
      <div class="min-h-0 min-w-0 flex-1">
        <slot />
      </div>
    </div>
    <AppTabBar v-if="keyboardHeight === 0" class="md:hidden" />
  </div>
</template>
