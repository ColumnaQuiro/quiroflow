<script setup lang="ts">
// The patient side of the app, with tabs. Mirrors layouts/practitioner.vue,
// including why the bar disappears rather than hides when the keyboard is
// up: a page that pads its own bottom by the keyboard height (the message
// composer) would otherwise land a tab-bar-sized gap above it.
const { keyboardHeight } = useKeyboardInset()
// Off on the home screen until there is a signed-in patient behind it (see
// pages/index.vue); the bottom inset is then padded here instead of by the bar.
const tabsVisible = usePatientTabsVisible()

// A patient's phone registers for push too, once there is a signed-in,
// linked patient (the tabs show exactly then). Only the staff layout used to,
// so no patient ever had a token: the clinic's replies, broadcasts and
// appointment pushes all reached nobody.
const { register: registerForPush } = usePushNotifications()
watch(tabsVisible, (on) => { if (on) registerForPush() }, { immediate: true })

// A tapped "Mis hábitos" reminder opens Cuidarme (its buttons, Hecho and
// En 15 min, are handled natively without opening anything).
const habitOpened = useHabitReminders().onOpened(() => navigateTo('/care'))
onBeforeUnmount(() => habitOpened.then((h) => h.remove()))

// On an iPad the sections are a side menu instead of the tab bar (CSS, by
// width), headed by the patient's clinic.
const { items, isActive } = usePatientNav()
const { settings } = usePatientAppInfo()
const t = useT()
// Family accounts (composables/useFamily.ts): whose record every patient
// screen shows. The banner says it on each one; the screens re-mount per
// person, so nothing of the last person's stays on screen.
const family = useFamily()
const personKey = computed(() => family.active.value?.patientId ?? 'me')
// The sections an admin-only link does not reach, wherever they are opened
// from (an old notification, a link in a message): said, not shown empty.
const route = useRoute()
const CLINICAL = ['/care', '/progress', '/messages', '/documents', '/exercises', '/learn']
const locked = computed(() => !family.canSeeClinical.value && CLINICAL.some((p) => route.path === p || route.path.startsWith(`${p}/`)))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col md:flex-row" :style="tabsVisible ? undefined : 'padding-bottom: env(safe-area-inset-bottom)'">
    <AppSideNav
      v-if="tabsVisible"
      class="hidden md:flex"
      :items="items"
      :is-active="isActive"
      :title="settings.clinicName ?? t('Your clinic', 'Tu clínica')"
      :subtitle="t('Patient', 'Paciente')"
    />
    <!-- A flex column, and the keyed wrapper fills what the banner leaves:
         full-height screens (Messages, with its composer at the bottom) size
         themselves with h-full, which a plain block wrapper has no height
         for -- the composer then sat right under the last message. Taller
         screens still overflow the wrapper and scroll here as before. -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <PatientActingBanner v-if="tabsVisible" />
      <div v-if="locked" class="p-4"><PatientClinicalLocked /></div>
      <div v-else :key="personKey" class="flex min-h-0 flex-1 flex-col">
        <slot />
      </div>
    </div>
    <PatientTabBar v-if="tabsVisible && keyboardHeight === 0" class="md:hidden" />
  </div>
</template>
