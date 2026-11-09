<script setup lang="ts">
// Personal (owners only): the team in one place. Phase 1 of the "Equipo"
// spec, named Personal here because the sidebar's "Equipo" is the team chat --
// who is in today, holidays left, the month's hours, and what is waiting for
// the owner (Personas); and the whole team's leave across a year, with the
// days two practitioners are off at once (Vacaciones); and the month's pack
// for the gestoría (Gestoría). Each person opens onto their file
// (pages/personal/[id].vue).
// The route is owners only (utils/routePermissions.ts), as Turnos is.
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { timeZone } = useAccountTimeZone()

type Tab = 'people' | 'leave' | 'gestoria'
const tab = computed<Tab>({
  get: () => (route.query.tab === 'leave' || route.query.tab === 'gestoria' ? route.query.tab : 'people'),
  set: (v) => router.replace({ query: { ...route.query, tab: v === 'people' ? undefined : v } }),
})
const tabs = computed(() => [
  { key: 'people' as const, label: t('People', 'Personas') },
  { key: 'leave' as const, label: t('Holidays', 'Vacaciones') },
  { key: 'gestoria' as const, label: t('Accountant', 'Gestoría') },
])
</script>

<template>
  <div class="flex h-full flex-col" data-cy="staff-page">
    <PageHeader :title="t('Staff', 'Personal')" :meta="t('Who is in, who is away, and what is waiting for you', 'Quién está, quién falta y qué te espera')" />

    <div role="tablist" class="flex shrink-0 gap-1 border-b border-line bg-surface px-4 sm:px-6">
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        role="tab"
        :aria-selected="tab === tb.key"
        :data-cy="`staff-tab-${tb.key}`"
        class="-mb-px flex h-12 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
        :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-4 sm:px-6">
      <template v-if="store.accountId">
        <StaffPeople v-if="tab === 'people'" :account-id="store.accountId" :time-zone="timeZone" @open-leave="tab = 'leave'" />
        <StaffGestoriaPack v-else-if="tab === 'gestoria'" />
        <StaffLeaveYear v-else :account-id="store.accountId" :time-zone="timeZone" />
      </template>
    </div>
  </div>
</template>
