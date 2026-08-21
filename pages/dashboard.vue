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
  DashboardNextUpTodayMiniWidget,
}

// Widgets scoped to "this week" (rather than the period filter below) get a
// fixed header meta; period-filtered widgets get the formatted date range.
const THIS_WEEK_TYPES = new Set(['weekly_visits', 'visit_summary', 'no_show_rate'])
const PERIOD_SCOPED_TYPES = new Set(['income_mini', 'appointment_distribution_mini', 'statistics_mini', 'memberships_mini', 'upcoming_visits_mini'])

const store = useAccountStore()
const { practitioners, load: loadFilterOptions } = useReportFilterOptions()
const { widgets, loaded, load: loadLayout, save, add, remove, setSize, reorder } = useDashboardLayout()

const editing = ref(false)
const practitionerFilter = ref('')
const range = ref<DateRange>(computePresetRange({ months: 1 }))

onMounted(() => {
  loadLayout()
  loadFilterOptions()
})

const draggedIndex = ref<number | null>(null)
function onDragStart(index: number) {
  draggedIndex.value = index
}
function onDragOver(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  reorder(draggedIndex.value, index)
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

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
})
const firstName = computed(() => store.teamMember?.full_name?.split(' ')[0] ?? '')
const todayLabel = computed(() => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))

function formatShort(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function widgetMeta(type: string): string | undefined {
  if (THIS_WEEK_TYPES.has(type)) return 'This week'
  if (PERIOD_SCOPED_TYPES.has(type)) return `${formatShort(range.value.from)} – ${formatShort(range.value.to)}`
  return undefined
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div>
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900">{{ greeting }}, {{ firstName }}</h1>
        <p class="text-[12.5px] text-ink-muted2">{{ store.accountName }} · {{ todayLabel }}</p>
      </div>
      <div class="flex items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :practitioners="practitioners" :clinics="[]" :show-clinic="false" />
        <UiBtn :variant="editing ? 'primary' : 'secondary'" @click="toggleEditing">{{ editing ? 'Done' : 'Edit layout' }}</UiBtn>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <DashboardAddWidgetPicker v-if="editing" :existing-types="widgets.map((w) => w.type)" @add="onAddWidget" />

      <div v-if="!loaded" class="py-10 text-center text-[13px] text-ink-faint">Loading…</div>
      <div v-else class="grid grid-cols-12 gap-3">
        <DashboardWidgetFrame
          v-for="(w, i) in widgets"
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
