// "Only their own figures" for reports and the dashboard, decided in one place.
//
// reports_own_only and dashboard_scope = 'own' were stored, seeded (every
// Practitioner role has both) and shown in the roles editor for months while
// nothing read them: a practitioner opening Income saw the whole clinic's
// takings. Every report and dashboard widget that can be narrowed to one
// practitioner already had a practitioner filter, so "own" is that filter,
// forced to the person looking and hidden from them -- the same attribution
// rule the filter always used (utils/incomeAttribution.ts), not a second one.
//
// Owners are never narrowed, whatever their role says: has_permission() treats
// an owner as holding everything, and a restriction is the opposite of a grant.
export function useOwnScope() {
  const store = useAccountStore()

  /** Set when reports must show only this member's own data. */
  const reportsPractitionerId = computed<string | null>(() => {
    if (store.isOwner || store.permissions.reports_own_only !== true) return null
    return store.teamMember?.id ?? null
  })

  const dashboardMode = computed<'all' | 'own' | 'none'>(() => {
    if (store.isOwner) return 'all'
    const value = store.permissions.dashboard_scope
    return value === 'all' || value === 'own' ? value : 'none'
  })

  /** Set when the dashboard must show only this member's own figures. */
  const dashboardPractitionerId = computed<string | null>(() => (dashboardMode.value === 'own' ? (store.teamMember?.id ?? null) : null))

  return { reportsPractitionerId, dashboardMode, dashboardPractitionerId }
}
