<script setup lang="ts">
// app.quiroflow.com's root has no marketing role (quiroflow.com's bare apex
// covers that) -- it's purely the staff entry point, so skip straight to
// sign-in. Logged-in users never reach this: middleware/account.global.ts
// redirects them to /dashboard before this page's setup runs.
await navigateTo('/login', { replace: true })
</script>

<template>
  <div />
</template>
