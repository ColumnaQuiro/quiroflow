<script setup lang="ts">
import { computePresetRange } from '~/composables/useDateRangePresets'
import type { DateRange } from '~/composables/useDateRangePresets'
import { widgetDef, NEXT_SIZE } from '~/utils/dashboardWidgets'
import DashboardWeeklyVisitsWidget from '~/components/dashboard/WeeklyVisitsWidget.vue'
import DashboardTotalPatientsWidget from '~/components/dashboard/TotalPatientsWidget.vue'
import DashboardActivePatientsWidget from '~/components/dashboard/ActivePatientsWidget.vue'
import DashboardVisitSummaryWidget from '~/components/dashboard/VisitSummaryWidget.vue'
import DashboardIncomeMiniWidget from '~/components/dashboard/IncomeMiniWidget.vue'
import DashboardAppointmentDistributionMiniWidget from '~/components/dashboard/AppointmentDistributionMiniWidget.vue'
import DashboardStatisticsMiniWidget from '~/components/dashboard/StatisticsMiniWidget.vue'
import DashboardMembershipsMiniWidget from '~/components/dashboard/MembershipsMiniWidget.vue'
import DashboardDebtorsMiniWidget from '~/components/dashboard/DebtorsMiniWidget.vue'
import DashboardUpcomingVisitsMiniWidget from '~/components/dashboard/UpcomingVisitsMiniWidget.vue'
import DashboardNoShowRateMiniWidget from '~/components/dashboard/NoShowRateMiniWidget.vue'
import DashboardRecallsDueMiniWidget from '~/components/dashboard/RecallsDueMiniWidget.vue'
import DashboardContinuityAlertsMiniWidget from '~/components/dashboard/ContinuityAlertsMiniWidget.vue'
import DashboardNextUpTodayMiniWidget from '~/components/dashboard/NextUpTodayMiniWidget.vue'

// <component :is="'StringName'"> doesn't resolve Nuxt's auto-imported
// components at runtime -- auto-import only rewrites literal tags found in
// templates at build time. Explicit imports + a local map are needed for
// dynamic-by-string resolution.
const WIDGET_COMPONENTS: Record<string, unknown> = {
  DashboardWeeklyVisitsWidget,
  DashboardTotalPatientsWidget,
  DashboardActivePatientsWidget,
  DashboardVisitSummaryWidget,
  DashboardIncomeMiniWidget,
  DashboardAppointmentDistributionMiniWidget,
  DashboardStatisticsMiniWidget,
  DashboardMembershipsMiniWidget,
  DashboardDebtorsMiniWidget,
  DashboardUpcomingVisitsMiniWidget,
  DashboardNoShowRateMiniWidget,
  DashboardRecallsDueMiniWidget,
  DashboardContinuityAlertsMiniWidget,
  DashboardNextUpTodayMiniWidget,
}

// Widgets scoped to "this week" (rather than the period filter below) get a
// fixed header meta; period-filtered widgets get the formatted date range.
const THIS_WEEK_TYPES = new Set(['weekly_visits', 'visit_summary', 'no_show_rate'])
const PERIOD_SCOPED_TYPES = new Set(['income_mini', 'appointment_distribution_mini', 'statistics_mini', 'memberships_mini', 'upcoming_visits_mini'])

const store = useAccountStore()
const { practitioners, load: loadFilterOptions } = useReportFilterOptions()
const { widgets, loaded, load: loadLayout, save, add, remove, setSize, reorder } = useDashboardLayout()
const t = useT()
const { preference: lang } = useLang()

const editing = ref(false)

// dashboard_scope. /dashboard stays reachable whatever it says -- it is where
// everyone lands after signing in, and where a refused route sends people --
// so the scope decides what is ON it rather than whether it opens:
//   'own'  -- every widget pinned to the viewer's own figures, the picker
//             hidden, and the two widgets that cannot be narrowed to one
//             practitioner (money owed on bonos, membership revenue) left out.
//   'none' -- no figures at all, and a sentence saying why.
// The route rule for /dashboard never ran (the middleware skips it to avoid
// a redirect loop), so until now 'none' only hid the sidebar link.
const { dashboardMode, dashboardPractitionerId } = useOwnScope()
const CLINIC_WIDE_WIDGETS = new Set(['debtors_mini', 'memberships_mini'])
const practitionerFilter = ref(dashboardPractitionerId.value ?? '')
const visibleWidgets = computed(() => (dashboardMode.value === 'own' ? widgets.value.filter((w) => !CLINIC_WIDE_WIDGETS.has(w.type)) : widgets.value))
const hiddenTypes = computed(() => (dashboardMode.value === 'own' ? [...CLINIC_WIDE_WIDGETS] : []))
const range = ref<DateRange>(computePresetRange({ months: 1 }))

onMounted(() => {
  loadLayout()
  loadFilterOptions()
})

const draggedIndex = ref<number | null>(null)
function onDragStart(index: number) {
  draggedIndex.value = index
}
// Indexes in the rendered list are not indexes in the saved layout once
// "own" leaves widgets out, so a drag maps back through the widget's id.
function onDragOver(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  const from = widgets.value.findIndex((w) => w.id === visibleWidgets.value[draggedIndex.value!]?.id)
  const to = widgets.value.findIndex((w) => w.id === visibleWidgets.value[index]?.id)
  if (from >= 0 && to >= 0) reorder(from, to)
  draggedIndex.value = index
}

async function toggleEditing() {
  if (editing.value) await save()
  editing.value = !editing.value
}

function onAddWidget(type: string) {
  add(type)
  save()
}

function onRemoveWidget(id: string) {
  remove(id)
  save()
}

function onCycleSize(id: string, currentSize: 'sm' | 'md' | 'lg') {
  setSize(id, NEXT_SIZE[currentSize])
  save()
}

const widgetProps = computed(() => ({
  dateRange: range.value,
  practitionerId: practitionerFilter.value || undefined,
}))

// Both of the strings below describe the viewer's own clock -- what time of
// day it is for them, and what day it is where they are. The server only has
// its own timezone, so it cannot know either, and computing them inside a
// plain computed() meant SSR and the browser could disagree.
//
// useState is what keeps that from being a hydration mismatch: the server's
// value travels in the payload, so the client's FIRST render is byte-identical
// to the server's, and onMounted then re-resolves against the viewer's real
// timezone and locale. A plain ref('') would also have hydrated cleanly, but
// at the cost of rendering the heading empty until mount.
function greetingBucket(hour: number) {
  if (hour < 12) return 'morning' as const
  if (hour < 18) return 'afternoon' as const
  return 'evening' as const
}
// The bucket, not the finished sentence -- storing the translated string would
// freeze it in whichever language the payload was built with.
const bucket = useState('dashboard-greeting', () => greetingBucket(new Date().getHours()))
onMounted(() => {
  bucket.value = greetingBucket(new Date().getHours())
})
const greeting = computed(() => {
  if (bucket.value === 'morning') return t('Good morning', 'Buenos días')
  if (bucket.value === 'afternoon') return t('Good afternoon', 'Buenas tardes')
  return t('Good evening', 'Buenas noches')
})
const firstName = computed(() => store.teamMember?.full_name?.split(' ')[0] ?? '')
// es-ES / en-GB rather than `undefined`, which means "whatever locale this
// runtime defaults to" -- Node's ICU during SSR and the viewer's browser
// locale after it. That disagreement rendered "Monday, September 14" on the
// server against "Monday 14 September" on the client, one hydration mismatch
// per dashboard load. en-GB because it is the day-month order the rest of the
// app writes dates in.
const dateLocale = computed(() => (lang.value === 'es' ? 'es-ES' : 'en-GB'))

// Same payload-then-correct treatment as the greeting. Worth stressing that
// the timezone half of this is a correctness bug, not just a cosmetic one: a
// clinic far enough from the server's timezone was told the wrong day
// outright, not merely a differently punctuated one.
function formatToday(locale: string) {
  return new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
}
const todayLabel = useState('dashboard-today', () => formatToday('en-GB'))
onMounted(() => {
  todayLabel.value = formatToday(dateLocale.value)
})

// Safe to format synchronously: the ISO string is parsed as local midnight,
// so every timezone agrees on the calendar day and only the wording varies.
function formatShort(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(dateLocale.value, { month: 'short', day: 'numeric' })
}
function widgetMeta(type: string): string | undefined {
  if (THIS_WEEK_TYPES.has(type)) return t('This week', 'Esta semana')
  if (PERIOD_SCOPED_TYPES.has(type)) return `${formatShort(range.value.from)} – ${formatShort(range.value.to)}`
  return undefined
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-4 py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
      <div>
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ greeting }}, {{ firstName }}</h1>
        <p class="text-[12.5px] text-ink-muted2">{{ store.accountName }} · {{ todayLabel }}</p>
      </div>
      <div v-if="dashboardMode !== 'none'" class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="dashboardPractitionerId" :practitioners="practitioners" :clinics="[]" :show-clinic="false" />
        <UiBtn :variant="editing ? 'primary' : 'secondary'" @click="toggleEditing">{{ editing ? t('Done', 'Hecho') : t('Edit layout', 'Editar diseño') }}</UiBtn>
      </div>
    </header>

    <div v-if="dashboardMode === 'none'" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="dashboard-none" data-ready="true">
      <UiEmptyState
        :title="t('No figures on your dashboard', 'Tu panel no muestra cifras')"
        :description="t('Your role does not include the dashboard\'s figures. Everything else your role allows is in the menu.', 'Tu rol no incluye las cifras del panel. Todo lo demás que tu rol permite está en el menú.')"
      />
    </div>
    <div v-else class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <DashboardAddWidgetPicker v-if="editing" :existing-types="[...widgets.map((w) => w.type), ...hiddenTypes]" @add="onAddWidget" />

      <div v-if="!loaded" class="grid grid-cols-12 gap-3">
        <!-- Mirrors the default layout's shape (1 two-thirds-width widget + 7
             third-width ones) so the page doesn't visibly jump once real
             widgets replace these. -->
        <div
          v-for="(span, i) in ['col-span-12 md:col-span-8', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4', 'col-span-12 md:col-span-4']"
          :key="i"
          class="rounded-card border border-line bg-surface p-4 shadow-card"
          :class="span"
        >
          <UiSkeleton class="h-4 w-28 rounded-ctlSm" />
          <div class="mt-4 space-y-2.5">
            <UiSkeleton class="h-3 w-full rounded-ctlSm" />
            <UiSkeleton class="h-3 w-4/5 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-3/5 rounded-ctlSm" />
          </div>
        </div>
      </div>
      <div v-else class="grid grid-cols-12 gap-3">
        <DashboardWidgetFrame
          v-for="(w, i) in visibleWidgets"
          :key="w.id"
          :title="widgetDef(w.type)?.label ?? w.type"
          :meta="widgetMeta(w.type)"
          :size="w.size"
          :editing="editing"
          :index="i"
          @remove="onRemoveWidget(w.id)"
          @cycle-size="onCycleSize(w.id, w.size)"
          @drag-start="onDragStart"
          @drag-over="onDragOver"
        >
          <component :is="WIDGET_COMPONENTS[widgetDef(w.type)?.component ?? '']" v-bind="widgetProps" />
        </DashboardWidgetFrame>
      </div>
    </div>
  </div>
</template>
