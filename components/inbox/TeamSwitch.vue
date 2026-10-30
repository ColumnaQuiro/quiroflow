<script setup lang="ts">
// "Patients | Team" at the top of the Inbox and of Team: the two kinds of
// conversation the front desk keeps, one click apart. Someone without the
// Inbox (a practitioner, by default) has no patients side to switch to, so
// they see nothing here and reach Team from the sidebar.
defineProps<{ current: 'patients' | 'team' }>()
const t = useT()
const { can } = usePermission()
const { unreadTotal } = useTeamChat()

const seg = 'flex h-8 touch:h-11 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-semibold'
</script>

<template>
  <nav v-if="can('inbox_access')" :aria-label="t('Conversations', 'Conversaciones')" class="flex gap-0.5 rounded-ctl bg-chip-bg p-[3px]" data-cy="inbox-team-switch">
    <NuxtLink to="/inbox" :class="[seg, current === 'patients' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted hover:text-ink-700']" :aria-current="current === 'patients' ? 'page' : undefined">
      {{ t('Patients', 'Pacientes') }}
    </NuxtLink>
    <NuxtLink to="/team-chat" data-cy="switch-to-team" :class="[seg, current === 'team' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted hover:text-ink-700']" :aria-current="current === 'team' ? 'page' : undefined">
      {{ t('Team', 'Equipo') }}
      <span v-if="unreadTotal > 0 && current !== 'team'" class="rounded-pill bg-brand px-1.5 py-px text-[11px] font-semibold text-surface">{{ unreadTotal }}</span>
    </NuxtLink>
  </nav>
</template>
