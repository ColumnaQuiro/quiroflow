import type { useAccountStore } from '../../stores/account'

// Who may open which report, on the app. The web answers it from its Pinia
// account store (utils/routePermissions.ts and composables/useOwnScope.ts),
// which this bundle does not have (see usePractitionerContext.ts). Both
// only ever read `isOwner` and `permissions` for a report path, so the
// practitioner context is handed to the SAME rules rather than restating
// them: a report the web refuses is not offered here either, and the
// clinic-wide ones (CLINIC_WIDE_REPORTS) stay hidden from "only their own
// figures".
export function useReportAccess() {
  const { context, loading } = usePractitionerContext()

  const asStore = computed(() => (context.value ? ({ isOwner: context.value.isOwner, permissions: context.value.permissions } as unknown as ReturnType<typeof useAccountStore>) : null))

  /** Whether this person may open the report at a web path (/reports/...). */
  function canOpen(path: string): boolean {
    return asStore.value ? isRouteAllowed(asStore.value, path) : false
  }

  /** Any report at all: the Reports tab is shown on this. */
  const hasReports = computed(() => canOpen('/reports'))

  /**
   * Set when reports must show only this member's own data
   * (reports_own_only) -- useOwnScope's reportsPractitionerId, from the context.
   */
  const reportsPractitionerId = computed<string | null>(() => {
    const c = context.value
    if (!c || c.isOwner || c.permissions.reports_own_only !== true) return null
    return c.teamMemberId
  })

  return { context, loading, canOpen, hasReports, reportsPractitionerId }
}
