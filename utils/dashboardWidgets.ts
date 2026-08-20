export type WidgetSize = 'sm' | 'md' | 'lg'

export interface WidgetDef {
  type: string
  label: string
  defaultSize: WidgetSize
  component: string
}

// Core widgets seed the default layout and are always "this week" scoped.
// Report-derived widgets are opt-in via the Add Widget picker and respect
// the dashboard's date-range/practitioner/clinic filter bar.
export const WIDGET_REGISTRY: WidgetDef[] = [
  { type: 'weekly_visits', label: 'Weekly Visits', defaultSize: 'lg', component: 'DashboardWeeklyVisitsWidget' },
  { type: 'total_patients', label: 'Total Patients', defaultSize: 'sm', component: 'DashboardTotalPatientsWidget' },
  { type: 'active_patients', label: 'Active Patients', defaultSize: 'sm', component: 'DashboardActivePatientsWidget' },
  { type: 'visit_summary', label: 'Visit Summary (this week)', defaultSize: 'md', component: 'DashboardVisitSummaryWidget' },
  { type: 'income_mini', label: 'Income', defaultSize: 'md', component: 'DashboardIncomeMiniWidget' },
  { type: 'appointment_distribution_mini', label: 'Appointment Distribution', defaultSize: 'md', component: 'DashboardAppointmentDistributionMiniWidget' },
  { type: 'statistics_mini', label: 'Statistics', defaultSize: 'sm', component: 'DashboardStatisticsMiniWidget' },
  { type: 'memberships_mini', label: 'Memberships', defaultSize: 'sm', component: 'DashboardMembershipsMiniWidget' },
  { type: 'debtors_mini', label: 'Debtors', defaultSize: 'sm', component: 'DashboardDebtorsMiniWidget' },
  { type: 'upcoming_visits_mini', label: 'Upcoming Visits', defaultSize: 'sm', component: 'DashboardUpcomingVisitsMiniWidget' },
]

export const CORE_WIDGET_TYPES = ['weekly_visits', 'total_patients', 'active_patients', 'visit_summary']

export function widgetDef(type: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type)
}

export const SIZE_COL_SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-4',
}

export const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { sm: 'md', md: 'lg', lg: 'sm' }
