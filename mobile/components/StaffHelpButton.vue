<script setup lang="ts">
// The help alert's button, for a screen's header bar (My Day, Team): opens
// HelpAlertSheet, which sends. Red and labelled, so it is found at once by
// someone who has never needed it before.
const t = useT()
const open = ref(false)
</script>

<template>
  <button
    type="button"
    class="flex h-9 shrink-0 items-center gap-1.5 rounded-ctl border border-danger-border bg-surface px-2.5 text-[13px] font-semibold text-danger-text active:bg-danger-bg"
    :aria-label="t('Alert the team', 'Avisar al equipo')"
    data-cy="team-alert-open"
    @click="open = true"
  >
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 1.5 13.5h13z" /><path d="M8 6.2v3.4M8 11.6v.1" /></svg>
    {{ t('Help', 'Ayuda') }}
  </button>
  <Teleport to="body">
    <HelpAlertSheet v-if="open" @close="open = false" />
  </Teleport>
</template>
