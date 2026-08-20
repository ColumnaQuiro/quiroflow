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

interface Rule {
  test: (path: string) => boolean
  check: (store: Store) => boolean
}

// Checked in order, most specific first — the first matching rule wins.
const rules: Rule[] = [
  { test: (p) => p === '/billing/services', check: (s) => can(s, 'billing_config') },
  { test: (p) => p === '/settings/team' || p === '/settings/practitioners', check: (s) => can(s, 'settings_access') && can(s, 'team_admin') },
  { test: (p) => p === '/settings/roles' || p.startsWith('/settings/roles/'), check: (s) => can(s, 'settings_access') && can(s, 'roles_admin') },
  {
    test: (p) => ['/settings/clinics', '/settings/appointment-types', '/settings/rooms'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'clinic_config'),
  },
  {
    test: (p) => ['/settings/packages', '/settings/memberships', '/settings/payments'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'billing_config'),
  },
  { test: (p) => ['/settings/whatsapp', '/settings/docs'].includes(p), check: (s) => can(s, 'settings_access') && can(s, 'communication_config') },
  {
    test: (p) => ['/settings/import', '/settings/migrate-attachments', '/settings/webhooks'].includes(p),
    check: (s) => can(s, 'settings_access') && can(s, 'data_admin'),
  },
  { test: (p) => p.startsWith('/settings'), check: (s) => can(s, 'settings_access') },
  { test: (p) => p.startsWith('/dashboard'), check: (s) => scopeNotNone(s, 'dashboard_scope') },
  { test: (p) => p.startsWith('/calendar'), check: (s) => scopeNotNone(s, 'calendar_scope') },
  { test: (p) => p.startsWith('/patients'), check: (s) => scopeNotNone(s, 'patients_scope') },
  { test: (p) => p.startsWith('/recalls'), check: (s) => can(s, 'recalls_access') },
  { test: (p) => p.startsWith('/billing'), check: (s) => can(s, 'billing_access') },
  { test: (p) => p.startsWith('/reports'), check: (s) => can(s, 'reports_access') },
]

export function isRouteAllowed(store: Store, path: string): boolean {
  const rule = rules.find((r) => r.test(path))
  return rule ? rule.check(store) : true
}
