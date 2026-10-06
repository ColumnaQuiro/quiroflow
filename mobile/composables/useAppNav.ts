// The app's sections, once: the bottom tab bar on a phone and the side menu
// on an iPad (components/AppSideNav.vue) draw from the same list, so the two
// cannot drift apart.
export interface AppNavItem {
  label: string
  to: string
  icon: string
}

export function useStaffNav() {
  const t = useT()
  const route = useRoute()
  // The Inbox only for roles that can see it (inbox_access), as the web's
  // sidebar does: without it every read comes back empty, which looked like
  // "no messages" rather than "not for you".
  const { context, can } = usePractitionerContext()
  const items = computed<AppNavItem[]>(() => [
    { label: t('My Day', 'Mi día'), to: '/my-day', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4' },
    { label: t('Calendar', 'Calendario'), to: '/calendar', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    { label: t('Patients', 'Pacientes'), to: '/patients', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
    ...(!context.value || can('inbox_access') ? [{ label: t('Inbox', 'Bandeja'), to: '/inbox', icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z' }] : []),
    { label: t('Profile', 'Perfil'), to: '/profile', icon: 'M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM3.2 13.4c0-2.3 2.1-3.6 4.8-3.6s4.8 1.3 4.8 3.6' },
  ])
  const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
  return { items, isActive }
}

// Same five destinations as the web portal (layouts/portal.vue), so a patient
// who uses both finds the same things in the same order.
export function usePatientNav() {
  const t = useT()
  const route = useRoute()
  const items = computed<AppNavItem[]>(() => [
    { label: t('Home', 'Inicio'), to: '/', icon: 'M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z' },
    { label: t('Visits', 'Citas'), to: '/visits', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    { label: t('Billing', 'Pagos'), to: '/billing', icon: 'M2 4h12v8h-12zM2 7h12' },
    { label: t('Files', 'Archivos'), to: '/documents', icon: 'M4 2h5l3 3v9H4zM9 2v3.2h3' },
    { label: t('Messages', 'Mensajes'), to: '/messages', icon: 'M2 3.5h12v8h-7l-3 2.5v-2.5h-2z' },
  ])
  // Home is an exact match -- every other path starts with '/', so a prefix
  // test would light it up on every tab.
  const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`))
  return { items, isActive }
}
