<script setup lang="ts">
// Números: the clinic's figures on the phone or iPad -- the web dashboard's
// own widgets (components/dashboard), not a second calculation of them, so
// a figure here is the figure on the web.
//
// Who sees what follows the web's dashboard_scope (useOwnScope):
//   owner   -- everything, the whole clinic;
//   'all'   -- the same;
//   'own'   -- every widget narrowed to the viewer as practitioner, and the
//              two that cannot be (money owed on bonos) left out;
//   other   -- no figures, and a sentence saying why.
//
// The period switch drives the widgets that take one (income, visit value,
// appointment mix); the rest are "this week" on the web too and say so.
import type { DateRange } from '../../composables/useDateRangePresets'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const router = useRouter()
const { context, loading } = usePractitionerContext()

const mode = computed<'all' | 'own' | 'none'>(() => {
  if (!context.value) return 'none'
  if (context.value.isOwner) return 'all'
  const scope = context.value.permissions.dashboard_scope
  return scope === 'all' || scope === 'own' ? scope : 'none'
})
const practitionerId = computed(() => (mode.value === 'own' ? context.value?.teamMemberId : undefined))

type Period = 'today' | 'week' | 'month'
const period = ref<Period>('month')
const range = computed<DateRange>(() =>
  period.value === 'today' ? computePresetRange({ days: 0 }) : period.value === 'week' ? getWeekRange() : computePresetRange({ months: 1 }),
)
const periodLabel = computed(() => (period.value === 'today' ? t('Today', 'Hoy') : period.value === 'week' ? t('This week', 'Esta semana') : t('This month', 'Este mes')))

// Remounted on a period change so each widget loads its own figures afresh.
const periodKey = computed(() => `${period.value}:${range.value.from}:${range.value.to}:${practitionerId.value ?? ''}`)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppPageHeader :title="t('Numbers', 'Números')" back @back="router.back()" />

    <AppSkeletonList v-if="loading" :rows="4" class="flex-1" />
    <p v-else-if="mode === 'none'" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="numbers-none">
      {{ t("Your role doesn't include the clinic's figures.", 'Tu rol no incluye las cifras de la clínica.') }}
    </p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-[max(1.5rem,calc((100%_-_52rem)/2))]" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)" data-cy="numbers">
      <div role="tablist" :aria-label="t('Period', 'Periodo')" class="grid grid-cols-3 gap-1 rounded-ctl bg-chip-bg p-[3px]">
        <button
          v-for="p in (['today', 'week', 'month'] as const)"
          :key="p"
          type="button"
          role="tab"
          :aria-selected="period === p"
          class="h-8 rounded-ctlSm text-[13px] font-semibold"
          :class="period === p ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'"
          :data-cy="`numbers-period-${p}`"
          @click="period = p"
        >
          {{ p === 'today' ? t('Today', 'Hoy') : p === 'week' ? t('Week', 'Semana') : t('Month', 'Mes') }}
        </button>
      </div>
      <p v-if="mode === 'own'" class="mt-2 text-[12px] text-ink-muted">{{ t('Your own figures, as your role sets.', 'Tus propias cifras, como marca tu rol.') }}</p>

      <div :key="periodKey" class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <section class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="numbers-income">
          <p class="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-900">{{ t('Income', 'Ingresos') }}<span class="text-[11.5px] font-normal text-ink-muted2">{{ periodLabel }}</span></p>
          <DashboardIncomeMiniWidget :date-range="range" :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-900">{{ t('Visit value & retention', 'Valor por visita y retención') }}<span class="text-[11.5px] font-normal text-ink-muted2">{{ periodLabel }}</span></p>
          <DashboardStatisticsMiniWidget :date-range="range" :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-900">{{ t('Appointment mix', 'Reparto de citas') }}<span class="text-[11.5px] font-normal text-ink-muted2">{{ periodLabel }}</span></p>
          <DashboardAppointmentDistributionMiniWidget :date-range="range" :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-900">{{ t('Visit summary', 'Resumen de visitas') }}<span class="text-[11.5px] font-normal text-ink-muted2">{{ t('This week', 'Esta semana') }}</span></p>
          <DashboardVisitSummaryWidget :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink-900">{{ t('No-show rate', 'Tasa de ausencias') }}<span class="text-[11.5px] font-normal text-ink-muted2">{{ t('This week', 'Esta semana') }}</span></p>
          <DashboardNoShowRateMiniWidget :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="mb-2 text-[13px] font-semibold text-ink-900">{{ t('Active patients', 'Pacientes activos') }}</p>
          <DashboardActivePatientsWidget :practitioner-id="practitionerId" />
        </section>
        <section v-if="mode === 'all'" class="rounded-card border border-line bg-surface p-4 shadow-card md:col-span-2" data-cy="numbers-debtors">
          <p class="mb-2 text-[13px] font-semibold text-ink-900">{{ t('Debtors', 'Deudores') }}</p>
          <DashboardDebtorsMiniWidget />
        </section>
      </div>
    </div>
  </div>
</template>
