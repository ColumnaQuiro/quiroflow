import type { NavBadge } from './useNavBadges'
import { isRouteAllowed } from '../utils/routePermissions'

// The staff app's pages, grouped as the sidebar shows them. One definition,
// read by the sidebar (components/AppSidebar.vue) and by the "Go to" list of
// the command palette (components/AppCommandPalette.vue): the palette had a
// hand-written copy that offered pages a role could not open and was missing
// seven that had been added here since.
//
// Relative imports, not `~`: the mobile app scans this directory too, and
// there `~` is mobile/.

export interface SidebarNavItem {
  label: string
  to: string
  perm: () => boolean
  /**
   * One SVG path on a 24-unit grid, drawn as a line by components/SidebarIcon.vue
   * (18px, round caps and joins). One picture per page, never shared with
   * another: two clocks and two stars once sat in the same list. A dot is a
   * zero-length line (`h.01`), which only shows because the caps are round.
   */
  icon: string
  badge?: NavBadge
  /**
   * Highlight only on this exact path. For an item whose `to` is a prefix of
   * its siblings' -- /growth against /growth/leads -- without which both it
   * and the real destination light up at once.
   */
  exact?: boolean
  /** Other words the palette finds this page by. The sidebar ignores them. */
  keywords?: string
}

export interface SidebarNavGroup {
  id: string
  label: string
  tier?: string
  /**
   * The items' names lean on the heading (Growth's "Overview", "Leads"), so a
   * list shown without it puts the heading in front: "Growth › Overview".
   */
  qualified?: boolean
  items: SidebarNavItem[]
}

export function useSidebarNavItems() {
  const { can, scope } = usePermission()
  const store = useAccountStore()
  const t = useT()

  const groups = computed<SidebarNavGroup[]>(() => store.isBlindSpotOnly ? blindSpotOnlyGroups() : [
    {
      id: 'today',
      label: t('Today', 'Hoy'),
      // The daily loop, in the order of the g-shortcuts: what reception has
      // open all day. The Inbox was the twelfth item an owner saw.
      items: [
        { label: t('Dashboard', 'Panel'), to: '/dashboard', perm: () => scope('dashboard_scope') !== 'none', icon: 'M5.5 3.5h3a2 2 0 0 1 2 2v5a2 2 0 0 1 -2 2h-3a2 2 0 0 1 -2 -2v-5a2 2 0 0 1 2 -2zM15.5 3.5h3a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-3a2 2 0 0 1 -2 -2v-1a2 2 0 0 1 2 -2zM5.5 15.5h3a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-3a2 2 0 0 1 -2 -2v-1a2 2 0 0 1 2 -2zM15.5 11.5h3a2 2 0 0 1 2 2v5a2 2 0 0 1 -2 2h-3a2 2 0 0 1 -2 -2v-5a2 2 0 0 1 2 -2z' },
        { label: t('My Day', 'Mi día'), to: '/practitioner', perm: () => scope('calendar_scope') !== 'none', icon: 'M7.5 4.5h9a2.5 2.5 0 0 1 2.5 2.5v11.5a2.5 2.5 0 0 1 -2.5 2.5h-9a2.5 2.5 0 0 1 -2.5 -2.5v-11.5a2.5 2.5 0 0 1 2.5 -2.5zM9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5M9 12.5l2 2 4-4.5', badge: 'myday' },
        { label: t('Calendar', 'Calendario'), to: '/calendar', perm: () => scope('calendar_scope') !== 'none', icon: 'M6 5h12a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1 -2.5 2.5h-12a2.5 2.5 0 0 1 -2.5 -2.5v-10.5a2.5 2.5 0 0 1 2.5 -2.5zM3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01' },
        { label: t('Inbox', 'Bandeja de entrada'), to: '/inbox', perm: () => can('inbox_access'), icon: 'M3.5 13.5l2.3-6.9A2.3 2.3 0 0 1 8 5h8a2.3 2.3 0 0 1 2.2 1.6l2.3 6.9V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18zM3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5', badge: 'inbox' },
      ],
    },
    {
      id: 'patients',
      label: t('Patients', 'Pacientes'),
      items: [
        { label: t('Patients', 'Pacientes'), to: '/patients', perm: () => scope('patients_scope') !== 'none', icon: 'M8.2 8a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0zM4.5 20.5c.8-3.9 3.9-6 7.5-6s6.7 2.1 7.5 6' },
        { label: t('Recalls', 'Recuperaciones'), to: '/recalls', perm: () => can('recalls_access'), icon: 'M9 4.5L4.5 9 9 13.5M4.5 9H14a5.5 5.5 0 0 1 0 11h-3', badge: 'recalls' },
        // Reuses recalls_access rather than a new permission key -- both are
        // patient-outreach lists with the same "who should staff be allowed to
        // see this" shape, and a brand new key would default to owner-only
        // until someone visits Settings > Roles to grant it, hiding the feature
        // from every non-owner account until then.
        { label: t('Waitlist', 'Lista de espera'), to: '/waitlist', perm: () => can('recalls_access'), icon: 'M6.5 3.5h11M6.5 20.5h11M8 3.5v2.8a4 4 0 0 0 1.6 3.2L12 12l2.4-2.5A4 4 0 0 0 16 6.3V3.5M8 20.5v-2.8a4 4 0 0 1 1.6-3.2L12 12l2.4 2.5a4 4 0 0 1 1.6 3.2v2.8' },
        { label: t('Care Plan Alerts', 'Alertas de plan'), to: '/care-plan-alerts', perm: () => can('recalls_access'), icon: 'M2.8 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0zM9.8 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0zM7.2 12h2.6M14.2 12h1.8M20 8v4.5M20 16h.01' },
        // Everyone's home exercises in one place, and assigning them to many at once.
        { label: t('Exercises', 'Ejercicios'), to: '/exercises', perm: () => can('exercises_manage'), icon: 'M6.3 6.5h0.4a1.3 1.3 0 0 1 1.3 1.3v8.4a1.3 1.3 0 0 1 -1.3 1.3h-0.4a1.3 1.3 0 0 1 -1.3 -1.3v-8.4a1.3 1.3 0 0 1 1.3 -1.3zM17.3 6.5h0.4a1.3 1.3 0 0 1 1.3 1.3v8.4a1.3 1.3 0 0 1 -1.3 1.3h-0.4a1.3 1.3 0 0 1 -1.3 -1.3v-8.4a1.3 1.3 0 0 1 1.3 -1.3zM2.5 10v4M21.5 10v4M8 12h8' },
        // Campaigns and Growth > Automations, as one: every automation, patient
        // or lead, lives here. In every plan -- lead automations inside it are
        // what needs Growth, and they say so. Campaigns became Automations;
        // the palette still finds it by the old name.
        { label: t('Automations', 'Automatizaciones'), to: '/automations', perm: () => can('communication_config'), icon: 'M13 2.5L5 13.5h6l-1 8 8-11h-6z', badge: 'automations', keywords: t('Campaigns', 'Campañas') },
      ],
    },
    {
      id: 'team',
      label: t('Team', 'Equipo'),
      // The clinic's own people, apart from the day's work: these three sat in
      // Today, where they pushed the Inbox out of it.
      items: [
        // Messages between colleagues. Everyone, like Working time: the people
        // who most need it have no Inbox (pages/team-chat.vue). "Team chat",
        // because Settings has a Team of its own.
        { label: t('Team chat', 'Chat de equipo'), to: '/team-chat', perm: () => true, icon: 'M4 4.5h10A1.5 1.5 0 0 1 15.5 6v6.5A1.5 1.5 0 0 1 14 14H8.5L5 17v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5zM18.5 9H20a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5h-1v3l-3.5-3H12a1.5 1.5 0 0 1-1.5-1.5v-.5', badge: 'team' },
        // Registro de jornada: everyone clocks, so everyone has it.
        { label: t('Working time', 'Registro de jornada'), to: '/jornada', perm: () => true, icon: 'M4.5 13.5a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0zM12 13.5V10M10 2.5h4M12 2.5V6M18.2 7.3l1.3-1.3' },
        // Personal: the team's people, holidays and what waits for the owner
        // (pages/personal.vue). Owners only, as Turnos and Comisiones are.
        { label: t('Staff', 'Personal'), to: '/personal', perm: () => store.isOwner, icon: 'M6.5 4h11a2.5 2.5 0 0 1 2.5 2.5v11.5a2.5 2.5 0 0 1 -2.5 2.5h-11a2.5 2.5 0 0 1 -2.5 -2.5v-11.5a2.5 2.5 0 0 1 2.5 -2.5zM9.4 10.5a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0zM8 17c.6-1.9 2.1-3 4-3s3.4 1.1 4 3M10 4V2.5h4V4' },
      ],
    },
    {
      id: 'money',
      label: t('Money', 'Dinero'),
      items: [
        { label: t('Billing', 'Facturación'), to: '/billing', perm: () => can('billing_access'), icon: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9.5 8h5M9.5 11.5h5M9.5 15h3' },
        { label: t('Reports', 'Informes'), to: '/reports', perm: () => can('reports_access'), icon: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12zM15 3.3a5.7 5.7 0 0 1 5.7 5.7H15z' },
      ],
    },
    {
      id: 'growth',
      label: t('Growth', 'Crecimiento'),
      // The one group carrying a tier badge: everything under it is part of the
      // paid Growth tier. (Automations, which is in every plan, moved up to
      // Patients.)
      tier: 'GROWTH',
      qualified: true,
      // No "Conversations" here any more. It was a second link to /inbox
      // (?ai=handling) that could never show as the page you were on, and did
      // nothing when clicked from the inbox itself, which reads the query only
      // on mount. The inbox's own "AI handling" chip is the same view.
      items: [
        // "Overview", not a second "Dashboard": collapsed, or read aloud, two
        // items with one name are indistinguishable.
        { label: t('Overview', 'Resumen'), to: '/growth', exact: true, perm: () => can('communication_config'), icon: 'M3.5 17.5L9 12l4 4 7.5-8M15.5 8h5v5' },
        { label: t('Leads', 'Leads'), to: '/growth/leads', perm: () => can('leads_access') || can('communication_config'), icon: 'M3.5 4.5h17l-6.5 8v6l-4 2v-8z' },
        { label: t('AI receptionist', 'Recepcionista IA'), to: '/growth/receptionist', perm: () => can('communication_config'), icon: 'M4.5 14v-2a7.5 7.5 0 0 1 15 0v2M5 13h0.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -1.5 1.5h-0.5a1.5 1.5 0 0 1 -1.5 -1.5v-3a1.5 1.5 0 0 1 1.5 -1.5zM18.5 13h0.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -1.5 1.5h-0.5a1.5 1.5 0 0 1 -1.5 -1.5v-3a1.5 1.5 0 0 1 1.5 -1.5zM19 19c0 1.5-1.5 2.5-3.5 2.5H13' },
        { label: t('Reputation', 'Reputación'), to: '/growth/reputation', perm: () => can('communication_config'), icon: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z' },
      ],
    },
  ])

  // An account that bought only Blind Spot (utils/blindSpotPlan.ts): its
  // tests and its patients. The rest of the app is a product it has not
  // bought, and the route guard turns it away anyway.
  function blindSpotOnlyGroups(): SidebarNavGroup[] {
    return [
      {
        id: 'blind-spot',
        label: 'Blind Spot',
        items: [
          { label: t('Tests', 'Pruebas'), to: '/blind-spot', perm: () => scope('patients_scope') !== 'none', icon: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM9.2 12a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0 -5.6 0z', keywords: t('Blind spot', 'Punto ciego') },
          { label: t('Patients', 'Pacientes'), to: '/patients', perm: () => scope('patients_scope') !== 'none', icon: 'M8.2 8a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0zM4.5 20.5c.8-3.9 3.9-6 7.5-6s6.7 2.1 7.5 6' },
        ],
      },
    ]
  }

  /** What this person's sidebar shows: each item's own permission, empty groups dropped. */
  const visibleGroups = computed(() =>
    groups.value.map((g) => ({ ...g, items: g.items.filter((i) => i.perm()) })).filter((g) => g.items.length > 0),
  )

  /**
   * The same items for a list that navigates without the sidebar in front of
   * it. Also asks the route guard (utils/routePermissions.ts), so nothing is
   * offered that the middleware would turn away.
   */
  const reachableGroups = computed(() =>
    visibleGroups.value.map((g) => ({ ...g, items: g.items.filter((i) => isRouteAllowed(store, i.to)) })).filter((g) => g.items.length > 0),
  )

  return { groups, visibleGroups, reachableGroups }
}
