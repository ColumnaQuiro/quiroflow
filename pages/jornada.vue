<script setup lang="ts">
import { clinicDateOf } from '~/utils/clinicClock'

// Registro de jornada (Estatuto de los Trabajadores art. 34.9). Everyone
// clocks themselves and sees their own month here and on My Day; owners also
// get the team's month, the corrections waiting for them, and the month's
// export -- CSV, or a PDF with a page per person to sign.
// Design: the "Registro de jornada" rows of the QuiroFlow canvas.
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { timeZone } = useAccountTimeZone()

type Tab = 'team' | 'shifts' | 'mine'
const tab = computed<Tab>({
  get: () => (!store.isOwner || route.query.tab === 'mine' ? 'mine' : route.query.tab === 'shifts' ? 'shifts' : 'team'),
  set: (v) => router.replace({ query: { ...route.query, tab: v } }),
})
const month = ref(clinicDateOf(new Date(), timeZone.value).slice(0, 7))
const exportUrl = (format: 'csv' | 'pdf') => `/api/time-records/export?month=${month.value}&format=${format}`
</script>

<template>
  <div class="flex h-full flex-col" data-cy="jornada-page">
    <PageHeader :title="t('Working time', 'Registro de jornada')" :meta="store.isOwner ? t('The team, month by month', 'El equipo, mes a mes') : t('Your days and hours', 'Tus días y tus horas')">
      <template v-if="store.isOwner && tab === 'team'">
        <input v-model="month" type="month" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700" data-cy="jornada-month" />
        <a :href="exportUrl('csv')" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover" data-cy="jornada-export-csv">{{ t('Export CSV', 'Exportar CSV') }}</a>
        <a :href="exportUrl('pdf')" class="inline-flex h-9 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover" data-cy="jornada-export-pdf">{{ t('PDF to sign', 'PDF para firmar') }}</a>
      </template>
    </PageHeader>

    <div v-if="store.isOwner" role="tablist" class="flex shrink-0 gap-1 border-b border-line bg-surface px-4 sm:px-6">
      <button
        v-for="tb in ([{ key: 'team', label: t('Month', 'Mes') }, { key: 'shifts', label: t('Shifts', 'Turnos') }, { key: 'mine', label: t('Mine', 'Mi jornada') }] as const)"
        :key="tb.key"
        type="button"
        role="tab"
        :aria-selected="tab === tb.key"
        :data-cy="`jornada-tab-${tb.key}`"
        class="-mb-px flex h-12 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
        :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-4 sm:px-6">
      <template v-if="store.accountId && store.teamMember">
        <TimeclockTeamMonth v-if="tab === 'team'" :account-id="store.accountId" :time-zone="timeZone" :month="month" />
        <TimeclockTeamShifts v-else-if="tab === 'shifts'" :account-id="store.accountId" :time-zone="timeZone" />
        <div v-else class="mx-auto flex max-w-xl flex-col gap-4">
          <TimeclockClockCard :account-id="store.accountId" :team-member-id="store.teamMember.id" :time-zone="timeZone" month-to="/jornada?tab=mine" />
          <TimeclockMyMonth :key="timeZone" :account-id="store.accountId" :team-member-id="store.teamMember.id" :time-zone="timeZone" />
          <TimeclockMyLeave :key="`leave-${timeZone}`" :account-id="store.accountId" :team-member-id="store.teamMember.id" :time-zone="timeZone" />
        </div>
      </template>
    </div>
  </div>
</template>
