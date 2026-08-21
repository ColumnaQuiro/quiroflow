export type WidgetSize = 'sm' | 'md' | 'lg'

export interface WidgetDef {
  type: string
  label: string
  defaultSize: WidgetSize
  component: string
}

// Core widgets seed the default layout and are always "this week" scoped.
// Report-derived widgets are opt-in via the "Add a widget" tray and respect
// the dashboard's date-range/practitioner/clinic filter bar.
//
// defaultSize doubles as each widget's slot in the default 12-column layout:
// weekly_visits (8) + income_mini (4) fill row one, the three "sm" list
// widgets fill row two, and the three "sm" KPIs fill row three.
export const WIDGET_REGISTRY: WidgetDef[] = [
  { type: 'weekly_visits', label: 'Visits this week', defaultSize: 'md', component: 'DashboardWeeklyVisitsWidget' },
  { type: 'income_mini', label: 'Income this month', defaultSize: 'sm', component: 'DashboardIncomeMiniWidget' },
  { type: 'visit_summary', label: 'Visit summary', defaultSize: 'sm', component: 'DashboardVisitSummaryWidget' },
  { type: 'debtors_mini', label: 'Debtors', defaultSize: 'sm', component: 'DashboardDebtorsMiniWidget' },
  { type: 'next_up_today', label: 'Next up today', defaultSize: 'sm', component: 'DashboardNextUpTodayMiniWidget' },
  { type: 'active_patients', label: 'Active patients', defaultSize: 'sm', component: 'DashboardActivePatientsWidget' },
  { type: 'no_show_rate', label: 'No-show rate', defaultSize: 'sm', component: 'DashboardNoShowRateMiniWidget' },
  { type: 'recalls_due', label: 'Recalls due', defaultSize: 'sm', component: 'DashboardRecallsDueMiniWidget' },
  { type: 'total_patients', label: 'Total patients', defaultSize: 'sm', component: 'DashboardTotalPatientsWidget' },
  { type: 'appointment_distribution_mini', label: 'Appointment distribution', defaultSize: 'sm', component: 'DashboardAppointmentDistributionMiniWidget' },
  // Note: despite their type/component names, DashboardStatisticsMiniWidget's
  // body is actually visits/PVA/retention, and DashboardUpcomingVisitsMiniWidget's
  // body is actually the monthly appointment-volume trend -- a pre-existing
  // mismatch between these two files' names and their content. Labels below
  // describe what each component really renders rather than its file name;
  // left the `type`/`component` values alone since those are persisted in
  // team_members.dashboard_layout and renaming them would need a migration.
  { type: 'statistics_mini', label: 'Visit value & retention', defaultSize: 'sm', component: 'DashboardStatisticsMiniWidget' },
  { type: 'memberships_mini', label: 'Memberships', defaultSize: 'sm', component: 'DashboardMembershipsMiniWidget' },
  { type: 'upcoming_visits_mini', label: 'Appointment volume trend', defaultSize: 'sm', component: 'DashboardUpcomingVisitsMiniWidget' },
]

// The default dashboard layout, in grid order.
export const CORE_WIDGET_TYPES = [
  'weekly_visits',
  'income_mini',
  'visit_summary',
  'debtors_mini',
  'next_up_today',
  'active_patients',
  'no_show_rate',
  'recalls_due',
]

export function widgetDef(type: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type)
}

// 12-column grid: sm = a third, md = two-thirds, lg = full width.
export const SIZE_COL_SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-4',
  md: 'col-span-8',
  lg: 'col-span-12',
}

export const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { sm: 'md', md: 'lg', lg: 'sm' }
