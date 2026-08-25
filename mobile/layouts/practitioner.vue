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
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1">
      <slot />
    </div>
    <AppTabBar v-if="keyboardHeight === 0" />
  </div>
</template>
