<script setup lang="ts">
// Growth > Automations moved into Automations (/automations), which covers
// lead automations and every other kind. Kept as a redirect with its query,
// because a failed run was linked straight to (?tab=executions&run=<id>):
// the list resolves ?run to that run's automation, on its People tab.
definePageMeta({
  redirect: (to) => ({ path: '/automations', query: to.query }),
})
</script>

<template>
  <div />
</template>
