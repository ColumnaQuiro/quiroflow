import type { useAccountStore } from '~/stores/account'

type Store = ReturnType<typeof useAccountStore>

function can(store: Store, key: string) {
  return store.isOwner || store.permissions[key] === true
}
function scopeNotNone(store: Store, key: string) {
  if (store.isOwner) return true
  const value = store.permissions[key]
  return value === 'all' || value === 'own'
}

// A restriction-style key (true takes something away). Never applies to an
// owner, as has_restriction() in the database.
function restrictedTo(store: Store, key: string) {
  return !store.isOwner && store.permissions[key] === true
}

export const CLINIC_WIDE_REPORTS = ['/reports/scheduled-reminders', '/reports/debtors', '/reports/memberships', '/reports/data-exports', '/reports/custom']

interface Rule {
  test: (path: string) => boolean
  check: (store: Store) => boolean
}

// Checked in order, most specific first — the first matching rule wins.
const rules: Rule[] = [
  { test: (p) => p === '/settings/team' || p === '/settings/practitioners', check: (s) => can(s, 'settings_access') && can(s, 'team_admin') },
  { test: (p) => p === '/settings/roles' || p.startsWith('/settings/roles/'), check: (s) => can(s, 'settings_access') && can(s, 'roles_admin') },
  {
    // /settings/clinics/<id> is one clinic's own page, under the same key as the list.
    test: (p) => ['/settings/clinics', '/settings/appointment-types', '/settings/rooms', '/settings/referral-sources', '/settings/app'].includes(p) || p.startsWith('/settings/clinics/'),
    check: (s) => can(s, 'settings_access') && can(s, 'clinic_config'),
  },
  {
    test: (p) => ['/settings/services', '/settings/packages', '/settings/memberships', '/settings/payments', '/settings/fiscal-data'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'billing_config'),
  },
  {
    test: (p) => ['/settings/whatsapp', '/settings/docs'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'communication_config'),
  },
  { test: (p) => p.startsWith('/campaigns'), check: (s) => can(s, 'communication_config') },
  {
    test: (p) => ['/settings/import', '/settings/migrate-attachments', '/settings/compress-files', '/settings/webhooks'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'data_admin'),
  },
  // Its own gate rather than the generic settings one: an active token can
  // read patient data and book appointments as the clinic, which is a wider
  // grant than "can open Settings".
  { test: (p) => p === '/settings/developers', check: (s) => can(s, 'settings_access') && can(s, 'developers_access') },
  { test: (p) => p.startsWith('/settings'), check: (s) => can(s, 'settings_access') },
  { test: (p) => p.startsWith('/dashboard'), check: (s) => scopeNotNone(s, 'dashboard_scope') },
  { test: (p) => p.startsWith('/calendar'), check: (s) => scopeNotNone(s, 'calendar_scope') },
  { test: (p) => p.startsWith('/practitioner'), check: (s) => scopeNotNone(s, 'calendar_scope') },
  { test: (p) => p.startsWith('/patients'), check: (s) => scopeNotNone(s, 'patients_scope') },
  // The sidebar already hides this link without inbox_access, but hiding a
  // link is not a guard: /inbox was still reachable by typing the URL, by a
  // bookmark, or from the command palette, and it loaded real conversations.
  { test: (p) => p.startsWith('/inbox'), check: (s) => can(s, 'inbox_access') },
  { test: (p) => p.startsWith('/recalls'), check: (s) => can(s, 'recalls_access') },
  { test: (p) => p.startsWith('/billing'), check: (s) => can(s, 'billing_access') },
  // Reports that are about the whole clinic and cannot be narrowed to one
  // practitioner -- money owed on bonos, membership revenue, reminder
  // delivery, bulk exports of the patient list, free-form custom reports.
  // "Only their own figures" (reports_own_only) cannot be honoured on them,
  // so they are not offered at all rather than shown whole.
  { test: (p) => CLINIC_WIDE_REPORTS.includes(p), check: (s) => can(s, 'reports_access') && !restrictedTo(s, 'reports_own_only') },
  { test: (p) => p.startsWith('/reports'), check: (s) => can(s, 'reports_access') },
]

export function isRouteAllowed(store: Store, path: string): boolean {
  const rule = rules.find((r) => r.test(path))
  return rule ? rule.check(store) : true
}
