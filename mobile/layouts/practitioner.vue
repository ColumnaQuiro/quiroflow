<script setup lang="ts">
// Registered once here (not per-tab) so switching between My Day/Calendar/
// Patients/Inbox doesn't re-register a push token on every navigation.
const { register: registerForPush } = usePushNotifications()
onMounted(registerForPush)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1">
      <slot />
    </div>
    <AppTabBar />
  </div>
</template>
