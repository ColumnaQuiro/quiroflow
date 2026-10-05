<script setup lang="ts">
// The patient side of the app, with tabs. Mirrors layouts/practitioner.vue,
// including why the bar disappears rather than hides when the keyboard is
// up: a page that pads its own bottom by the keyboard height (the message
// composer) would otherwise land a tab-bar-sized gap above it.
const { keyboardHeight } = useKeyboardInset()
// Off on the home screen until there is a signed-in patient behind it (see
// pages/index.vue); the bottom inset is then padded here instead of by the bar.
const tabsVisible = usePatientTabsVisible()

// On an iPad the sections are a side menu instead of the tab bar (CSS, by
// width), headed by the patient's clinic.
const { items, isActive } = usePatientNav()
const { settings } = usePatientAppInfo()
const t = useT()
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
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <slot />
    </div>
    <PatientTabBar v-if="tabsVisible && keyboardHeight === 0" class="md:hidden" />
  </div>
</template>
