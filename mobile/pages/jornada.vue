<script setup lang="ts">
// Mi jornada: this person's month of clocking -- days, hours, and asking an
// owner for a correction -- opened from the clock on My Day. The same
// component as the web's /jornada "Mine" tab (components/timeclock/MyMonth.vue);
// the team's month and the export are on the web.
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const router = useRouter()
const { context } = usePractitionerContext()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="jornada">
    <AppPageHeader :title="t('My working time', 'Mi jornada')" back @back="router.back()" />
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
      <div class="mx-auto max-w-[560px]">
        <TimeclockMyMonth v-if="context" :account-id="context.accountId" :team-member-id="context.teamMemberId" :time-zone="context.timeZone || DEFAULT_CLINIC_TIMEZONE" />
      </div>
    </div>
  </div>
</template>
