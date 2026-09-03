<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { context, loading } = usePractitionerContext()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="!context" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      This account isn't linked to a team record.
    </p>
    <PractitionerInbox v-else :account-id="context.accountId" :team-member-id="context.teamMemberId" :open-conversation-key="pendingConversationKey" />
  </div>
</template>
