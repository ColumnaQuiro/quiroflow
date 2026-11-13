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
const PERIODS: Period[] = ['today', 'week', 'month']
const route = useRoute()
const periodFrom = (q: unknown): Period => (PERIODS.includes(q as Period) ? (q as Period) : 'month')
const period = ref<Period>(periodFrom(route.query.period))
// The home-screen widget's figures open this on a period (?period=month).
watch(() => [route.query.period, route.query.w], () => { if (route.query.period) period.value = periodFrom(route.query.period) })
const range = computed<DateRange>(() =>
  period.value === 'today' ? computePresetRange({ days: 0 }) : period.value === 'week' ? getWeekRange() : computePresetRange({ months: 1 }),
)
const periodLabel = computed(() => (period.value === 'today' ? t('Today', 'Hoy') : period.value === 'week' ? t('This week', 'Esta semana') : t('This month', 'Este mes')))

// The income widget's payments, for the curve under it (AppIncomeCurve);
// cleared on a period change so the old period's line is never shown under
// the new figure.
interface IncomePoint { at: string; cents: number }
const incomeSeries = ref<{ from: string; to: string; prevFrom: string; current: IncomePoint[]; previous: IncomePoint[] } | null>(null)

// Remounted on a period change so each widget loads its own figures afresh.
const periodKey = computed(() => `${period.value}:${range.value.from}:${range.value.to}:${practitionerId.value ?? ''}`)
watch(periodKey, () => {
  incomeSeries.value = null
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppPageHeader :title="t('Numbers', 'Números')" back :lip="mode === 'none' || loading ? 'sheet' : 'none'" @back="router.back()" />

    <AppSkeletonList v-if="loading" :rows="4" class="flex-1" />
    <p v-else-if="mode === 'none'" class="m-4 rounded-card bg-surface px-4 py-3.5 text-[14px] text-ink-muted shadow-card" data-cy="numbers-none">
      {{ t("Your role doesn't include the clinic's figures.", 'Tu rol no incluye las cifras de la clínica.') }}
    </p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)" data-cy="numbers">
      <!-- The back plane, carried on from the header: the period, and the
           income for it as the headline, with its curve (assets/css/main.css). -->
      <div class="qf-plane qf-lip px-4 pt-1 md:px-[max(1.5rem,calc((100%_-_52rem)/2))]">
        <div role="tablist" :aria-label="t('Period', 'Periodo')" class="grid grid-cols-3 gap-1 rounded-full bg-chip-bg p-[3px]">
          <button
            v-for="p in (['today', 'week', 'month'] as const)"
            :key="p"
            type="button"
            role="tab"
            :aria-selected="period === p"
            class="h-10 rounded-full text-[14px] font-semibold"
            :class="period === p ? 'bg-brand text-brand-on' : 'text-ink-muted'"
            :data-cy="`numbers-period-${p}`"
            @click="period = p"
          >
            {{ p === 'today' ? t('Today', 'Hoy') : p === 'week' ? t('Week', 'Semana') : t('Month', 'Mes') }}
          </button>
        </div>
        <p v-if="mode === 'own'" class="mt-2 text-[13px] text-ink-muted">{{ t('Your own figures, as your role sets.', 'Tus propias cifras, como marca tu rol.') }}</p>

        <section :key="`income:${periodKey}`" class="mt-5" data-cy="numbers-income">
          <p class="mb-1 text-[13.5px] font-semibold text-ink-muted">{{ t('Income', 'Ingresos') }} · {{ periodLabel }}</p>
          <DashboardIncomeMiniWidget :date-range="range" :practitioner-id="practitionerId" hero @series="incomeSeries = $event" />
          <AppIncomeCurve class="mt-4" :series="incomeSeries" />
        </section>
        <div class="h-5" />
      </div>

      <div :key="periodKey" class="grid grid-cols-1 gap-3 px-4 pt-1 md:grid-cols-2 md:px-[max(1.5rem,calc((100%_-_52rem)/2))]">
        <section class="rounded-card bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[15px] font-semibold text-ink-900">{{ t('Visit value & retention', 'Valor por visita y retención') }}<span class="text-[12.5px] font-normal text-ink-muted2">{{ periodLabel }}</span></p>
          <DashboardStatisticsMiniWidget :date-range="range" :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[15px] font-semibold text-ink-900">{{ t('Appointment mix', 'Reparto de citas') }}<span class="text-[12.5px] font-normal text-ink-muted2">{{ periodLabel }}</span></p>
          <DashboardAppointmentDistributionMiniWidget :date-range="range" :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[15px] font-semibold text-ink-900">{{ t('Visit summary', 'Resumen de visitas') }}<span class="text-[12.5px] font-normal text-ink-muted2">{{ t('This week', 'Esta semana') }}</span></p>
          <DashboardVisitSummaryWidget :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card bg-surface p-4 shadow-card">
          <p class="mb-2 flex items-baseline justify-between text-[15px] font-semibold text-ink-900">{{ t('No-show rate', 'Tasa de ausencias') }}<span class="text-[12.5px] font-normal text-ink-muted2">{{ t('This week', 'Esta semana') }}</span></p>
          <DashboardNoShowRateMiniWidget :practitioner-id="practitionerId" />
        </section>
        <section class="rounded-card bg-surface p-4 shadow-card">
          <p class="mb-2 text-[15px] font-semibold text-ink-900">{{ t('Active patients', 'Pacientes activos') }}</p>
          <DashboardActivePatientsWidget :practitioner-id="practitionerId" />
        </section>
        <section v-if="mode === 'all'" class="rounded-card bg-surface p-4 shadow-card md:col-span-2" data-cy="numbers-debtors">
          <p class="mb-2 text-[15px] font-semibold text-ink-900">{{ t('Debtors', 'Deudores') }}</p>
          <DashboardDebtorsMiniWidget />
        </section>
      </div>
    </div>
  </div>
</template>
