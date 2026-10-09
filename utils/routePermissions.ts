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

export const CLINIC_WIDE_REPORTS = ['/reports/scheduled-reminders', '/reports/debtors', '/reports/memberships', '/reports/data-exports']

interface Rule {
  test: (path: string) => boolean
  check: (store: Store) => boolean
}

// Checked in order, most specific first — the first matching rule wins.
const rules: Rule[] = [
  // /settings/team/<id> is one person's own page, under the same key as the list.
  { test: (p) => p === '/settings/team' || p.startsWith('/settings/team/') || p === '/settings/practitioners', check: (s) => can(s, 'settings_access') && can(s, 'team_admin') },
  { test: (p) => p === '/settings/roles' || p.startsWith('/settings/roles/'), check: (s) => can(s, 'settings_access') && can(s, 'roles_admin') },
  {
    // /settings/clinics/<id> and /settings/appointment-types/<id> are one
    // clinic's or one type's own page, under the same key as their list.
    test: (p) =>
      // online-booking, reschedule-reasons and new-patient-fields were missing
      // until 30 Sep 2026 and fell through to plain settings_access, so a
      // role the menu hid them from could still open them by address.
      ['/settings/clinics', '/settings/appointment-types', '/settings/rooms', '/settings/referral-sources', '/settings/exercises', '/settings/app', '/settings/online-booking', '/settings/reschedule-reasons', '/settings/new-patient-fields'].includes(p) ||
      p.startsWith('/settings/clinics/') ||
      p.startsWith('/settings/appointment-types/'),
    check: (s) => can(s, 'settings_access') && can(s, 'clinic_config'),
  },
  // Owners only, whatever the role: whether the clinic's records go to the
  // AEAT, and under whose certificate, is the company's own decision.
  { test: (p) => p === '/settings/verifactu', check: (s) => s.isOwner },
  // Owners only, for the same kind of reason: who opened which patient's
  // record, and every version of a clinical note, are questions for the
  // clinic as data controller. The database refuses anyone else too
  // (audit_require_owner, 20261008070424_audit_trail.sql).
  { test: (p) => p === '/settings/activity', check: (s) => s.isOwner },
  {
    // payment-methods, invoice-settings and fiscal-data now redirect into
    // Payments and Invoicing; they keep the gate so a bookmark never lands
    // anywhere unguarded.
    test: (p) =>
      ['/settings/services', '/settings/packages', '/settings/memberships', '/settings/payments', '/settings/invoicing', '/settings/payment-methods', '/settings/invoice-settings', '/settings/fiscal-data'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'billing_config'),
  },
  {
    test: (p) => ['/settings/messages', '/settings/communications-general', '/settings/whatsapp', '/settings/saved-replies', '/settings/docs', '/settings/leads'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'communication_config'),
  },
  // /campaigns and /growth/automations redirect here; the old prefix keeps its
  // gate so a bookmark never lands anywhere unguarded.
  { test: (p) => p === '/automations' || p.startsWith('/automations/') || p.startsWith('/campaigns'), check: (s) => can(s, 'communication_config') },
  // migrate-attachments and compress-files now redirect into Files; they keep
  // the gate so a bookmark never lands anywhere unguarded.
  {
    test: (p) => ['/settings/import', '/settings/files', '/settings/migrate-attachments', '/settings/compress-files'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'data_admin'),
  },
  // Its own gate rather than the generic settings one: an active token can
  // read patient data and book appointments as the clinic, which is a wider
  // grant than "can open Settings". Webhooks sit under it too: a webhook's
  // secret and its stream of patient events are the same kind of grant.
  { test: (p) => p === '/settings/developers' || p === '/settings/webhooks', check: (s) => can(s, 'settings_access') && can(s, 'developers_access') },
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
  // delivery, bulk exports of the patient list. (Report pages are not among
  // them: every block on one is narrowed, or says it cannot be.)
  // "Only their own figures" (reports_own_only) cannot be honoured on them,
  // so they are not offered at all rather than shown whole.
  { test: (p) => CLINIC_WIDE_REPORTS.includes(p), check: (s) => can(s, 'reports_access') && !restrictedTo(s, 'reports_own_only') },
  { test: (p) => p.startsWith('/reports'), check: (s) => can(s, 'reports_access') },
]

export function isRouteAllowed(store: Store, path: string): boolean {
  const rule = rules.find((r) => r.test(path))
  return rule ? rule.check(store) : true
}
