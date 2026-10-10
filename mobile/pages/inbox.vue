<script setup lang="ts">
// Kept alive between tabs: back from the Calendar, the Inbox is on the same
// conversation (or the same place in the list) -- see useKeptAlive.
defineOptions({ name: 'StaffInboxPage' })
definePageMeta({ layout: 'practitioner', keepalive: true })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { context, loading, can } = usePractitionerContext()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppSkeletonList v-if="loading" avatar class="min-h-0 flex-1" />
    <p v-else-if="!context" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      {{ t("This account isn't linked to a team record.", 'Esta cuenta no está vinculada a una ficha de equipo.') }}
    </p>
    <p v-else-if="!can('inbox_access')" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted" data-cy="inbox-no-access">
      {{ t('Your role does not include the Inbox.', 'Tu rol no incluye la Bandeja.') }}
    </p>
    <!-- Keyed by who is reading: kept alive, a switch of account would
         otherwise keep showing the last one's conversations. -->
    <PractitionerInbox v-else :key="`${context.accountId}:${context.teamMemberId}`" :account-id="context.accountId" :team-member-id="context.teamMemberId" :open-conversation-key="pendingConversationKey" />
  </div>
</template>
