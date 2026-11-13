<script setup lang="ts">
// Conversations | Team, at the top of the Inbox tab. Team messages used to
// have a tab of their own; they are read far less than the Inbox, so they
// now share its tab and this switch moves between the two pages
// (/inbox and /team-chat, both kept alive, so each is where it was left).
// Each side shows its own unread count, as the tab's badge adds them up.
//
// Only for roles with the Inbox: without it the tab IS Team
// (composables/useAppNav.ts) and there is nothing to switch to.
const props = defineProps<{ current: 'inbox' | 'team' }>()
const t = useT()
const router = useRouter()
const { count: inboxUnread } = useInboxUnread()
const { unreadTotal: teamUnread } = useStaffTeamChat()

function go(to: 'inbox' | 'team') {
  if (to === props.current) return
  // replace, not push: the switch is one place with two faces, and Back
  // from either should leave the tab rather than flip between them.
  router.replace(to === 'inbox' ? '/inbox' : '/team-chat')
}
</script>

<template>
  <!-- Tabs under the Inbox title, on the back plane: the current one in white
       with the plane's live-colour underline. -->
  <div role="tablist" :aria-label="t('Messages', 'Mensajes')" class="flex min-w-0 gap-6" data-cy="inbox-team-switch">
    <button
      v-for="s in ([['inbox', t('Conversations', 'Conversaciones'), inboxUnread], ['team', t('Team', 'Equipo'), teamUnread]] as const)"
      :key="s[0]"
      type="button"
      role="tab"
      :aria-selected="current === s[0]"
      class="relative flex h-11 min-w-0 items-center gap-1.5 text-[16px] font-[650] after:absolute after:inset-x-0 after:bottom-0.5 after:h-[3px] after:rounded-full"
      :class="current === s[0] ? 'text-ink-900 after:bg-[rgb(var(--plane-live))]' : 'text-ink-muted after:bg-transparent'"
      :data-cy="`inbox-switch-${s[0]}`"
      @click="go(s[0])"
    >
      <span class="truncate">{{ s[1] }}</span>
      <span v-if="s[2]" class="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-danger-text px-1 text-[10.5px] font-bold leading-none text-danger-on">
        {{ s[2] > 99 ? '99+' : s[2] }}<span class="sr-only">&nbsp;{{ t('unread', 'sin leer') }}</span>
      </span>
    </button>
  </div>
</template>
