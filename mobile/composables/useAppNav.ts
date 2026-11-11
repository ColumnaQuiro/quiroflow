// The app's sections, once: the bottom tab bar on a phone and the side menu
// on an iPad (components/AppSideNav.vue) draw from the same list, so the two
// cannot drift apart.
export interface AppNavItem {
  label: string
  to: string
  icon: string
  /** A count drawn on the item (the Inbox's unread conversations, Team's unread messages). */
  badge?: number
  /**
   * False: in the iPad side menu only. Five tabs fit a phone's bar at a size
   * a thumb can hit; Profile is reached from the avatar on My Day instead.
   */
  inTabBar?: boolean
}

export function useStaffNav() {
  const t = useT()
  const route = useRoute()
  // The Inbox only for roles that can see it (inbox_access), as the web's
  // sidebar does: without it every read comes back empty, which looked like
  // "no messages" rather than "not for you".
  const { context, can } = usePractitionerContext()
  const { count: unread } = useInboxUnread()
  // Team messages for everyone, Inbox or not: the people who most need them
  // (practitioners asking the desk for the next patient) are the ones whose
  // role has no Inbox, as on the web's sidebar.
  const { unreadTotal: teamUnread } = useStaffTeamChat()
  // Team messages share the Inbox's tab (components/InboxTeamSwitch.vue): they
  // had a tab of their own and were read far less than the Inbox. The badge
  // adds both up. Without the Inbox the tab is Team, under its own name.
  const withInbox = computed(() => !context.value || can('inbox_access'))
  // Reports for whoever the web shows them to; Números leads the list.
  const { hasReports } = useReportAccess()
  const items = computed<AppNavItem[]>(() => [
    { label: t('My Day', 'Mi día'), to: '/my-day', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4' },
    { label: t('Calendar', 'Calendario'), to: '/calendar', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    { label: t('Patients', 'Pacientes'), to: '/patients', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
    withInbox.value
      ? { label: t('Inbox', 'Bandeja'), to: '/inbox', icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z', badge: unread.value + teamUnread.value }
      : { label: t('Team', 'Equipo'), to: '/team-chat', icon: 'M5.6 7.2a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6zM1.6 13.4c0-2.1 1.8-3.4 4-3.4s4 1.3 4 3.4M10.9 7.1a2 2 0 100-4M11.6 10.1c1.6.3 2.8 1.4 2.8 3.3', badge: teamUnread.value },
    // Shown while the role is still loading, as the Inbox is, so the bar
    // does not shift sideways when it arrives; the hub says so if it's not theirs.
    ...(!context.value || hasReports.value ? [{ label: t('Reports', 'Informes'), to: '/reports', icon: 'M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V3' }] : []),
    // Personal: owners only, as on the web's sidebar. In the iPad's side menu;
    // on a phone the five tabs are taken, so it opens from the Reports hub.
    ...(context.value?.isOwner ? [{ label: t('Staff', 'Personal'), to: '/personal', inTabBar: false, icon: 'M2.5 3h11v10h-11zM6 6.6a1.4 1.4 0 102.8 0 1.4 1.4 0 00-2.8 0M4.6 11c.3-1.2 1.3-1.9 2.8-1.9s2.5.7 2.8 1.9M10.8 5.6h1.4M10.8 7.6h1.4' }] : []),
    { label: t('Profile', 'Perfil'), to: '/profile', inTabBar: false, icon: 'M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM3.2 13.4c0-2.3 2.1-3.6 4.8-3.6s4.8 1.3 4.8 3.6' },
  ])
  const isActive = (to: string) => {
    // Team is the other side of the Inbox's tab, so the tab stays lit there.
    if (to === '/inbox' && route.path === '/team-chat') return true
    // Números opens from the Reports hub (and from My Day), and is part of it.
    if (to === '/reports' && route.path === '/numbers') return true
    return route.path === to || route.path.startsWith(`${to}/`)
  }
  return { items, isActive }
}

// The patient's tabs. Five fit a phone's tab bar, so each answers one
// question: what's next (Inicio), my visits, plan and what I've paid (Plan),
// how I'm doing (Progreso), my papers, my messages. Pagos is no longer a tab
// of its own: its bonos, balance and invoices are on Plan, and the full
// list (/billing) opens from there and from Inicio's "pendiente" banner.
// "Plan", not "Tratamiento": a chiropractor in Spain may not call their care
// a treatment.
// Cuidarme -- exercises, their own habits, the streak, what to read -- took
// Documentos' place in the tab bar; Documentos stays in the iPad's side menu
// and opens from Inicio on a phone.
export function usePatientNav() {
  const t = useT()
  const route = useRoute()
  // A family member managed for visits and payments only (patient_managers
  // access 'admin') has no Cuidarme, Progreso, Mensajes or Documentos here.
  const { canSeeClinical } = useFamily()
  const all = computed<(AppNavItem & { clinical?: boolean })[]>(() => [
    { label: t('Home', 'Inicio'), to: '/', icon: 'M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z' },
    { label: t('Plan', 'Plan'), to: '/visits', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    { clinical: true, label: t('Self-care', 'Cuidarme'), to: '/care', icon: 'M8 13.5S2.5 10.2 2.5 6.3A2.8 2.8 0 018 4.8a2.8 2.8 0 015.5 1.5C13.5 10.2 8 13.5 8 13.5z' },
    { clinical: true, label: t('Progress', 'Progreso'), to: '/progress', icon: 'M2 13.5h12M3.5 11l3-3.5 2.5 2 4-5' },
    { clinical: true, label: t('Messages', 'Mensajes'), to: '/messages', icon: 'M2 3.5h12v8h-7l-3 2.5v-2.5h-2z' },
    { clinical: true, label: t('Documents', 'Documentos'), to: '/documents', inTabBar: false, icon: 'M4 2h5l3 3v9H4zM9 2v3.2h3' },
  ])
  const items = computed<AppNavItem[]>(() => all.value.filter((i) => canSeeClinical.value || !i.clinical))
  // Home is an exact match -- every other path starts with '/', so a prefix
  // test would light it up on every tab. The full invoice list belongs to Plan.
  const isActive = (to: string) => {
    if (to === '/') return route.path === '/'
    if (to === '/visits' && route.path.startsWith('/billing')) return true
    return route.path === to || route.path.startsWith(`${to}/`)
  }
  return { items, isActive }
}
