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

  const groups = computed<SidebarNavGroup[]>(() => [
    {
      id: 'today',
      label: t('Today', 'Hoy'),
      // The daily loop, in the order of the g-shortcuts: what reception has
      // open all day. The Inbox was the twelfth item an owner saw.
      items: [
        { label: t('Dashboard', 'Panel'), to: '/dashboard', perm: () => scope('dashboard_scope') !== 'none', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
        { label: t('My Day', 'Mi día'), to: '/practitioner', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4', badge: 'myday' },
        { label: t('Calendar', 'Calendario'), to: '/calendar', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
        { label: t('Inbox', 'Bandeja de entrada'), to: '/inbox', perm: () => can('inbox_access'), icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z', badge: 'inbox' },
      ],
    },
    {
      id: 'patients',
      label: t('Patients', 'Pacientes'),
      items: [
        { label: t('Patients', 'Pacientes'), to: '/patients', perm: () => scope('patients_scope') !== 'none', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
        { label: t('Recalls', 'Recuperaciones'), to: '/recalls', perm: () => can('recalls_access'), icon: 'M8 8m5.3 0a5.3 5.3 0 11-10.6 0 5.3 5.3 0 0110.6 0z', badge: 'recalls' },
        // Reuses recalls_access rather than a new permission key -- both are
        // patient-outreach lists with the same "who should staff be allowed to
        // see this" shape, and a brand new key would default to owner-only
        // until someone visits Settings > Roles to grant it, hiding the feature
        // from every non-owner account until then.
        { label: t('Waitlist', 'Lista de espera'), to: '/waitlist', perm: () => can('recalls_access'), icon: 'M8 2a6 6 0 100 12A6 6 0 008 2zM8 5v3.2l2.2 1.3' },
        { label: t('Care Plan Alerts', 'Alertas de plan'), to: '/care-plan-alerts', perm: () => can('recalls_access'), icon: 'M8 1.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.2 4.6 12l.7-3.8-2.8-2.7 3.8-.5z' },
        // Everyone's home exercises in one place, and assigning them to many at once.
        { label: t('Exercises', 'Ejercicios'), to: '/exercises', perm: () => can('exercises_manage'), icon: 'M2 8h2M12 8h2M4 5.5v5M12 5.5v5M5.5 6.8v2.4M10.5 6.8v2.4M5.5 8h5' },
        // Campaigns and Growth > Automations, as one: every automation, patient
        // or lead, lives here. In every plan -- lead automations inside it are
        // what needs Growth, and they say so. Campaigns became Automations;
        // the palette still finds it by the old name.
        { label: t('Automations', 'Automatizaciones'), to: '/automations', perm: () => can('communication_config'), icon: 'M8.9 1.5 3.5 9h3.8l-.6 5.5L12.5 7H8.7z', badge: 'automations', keywords: t('Campaigns', 'Campañas') },
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
        { label: t('Team chat', 'Chat de equipo'), to: '/team-chat', perm: () => true, icon: 'M5.5 6.5a2 2 0 100-4 2 2 0 000 4zM11 7a1.7 1.7 0 100-3.4A1.7 1.7 0 0011 7zM1.8 13c0-2 1.6-3.3 3.7-3.3S9.2 11 9.2 13M9.6 9.9c.4-.2.9-.3 1.4-.3 1.8 0 3.2 1.1 3.2 2.9', badge: 'team' },
        // Registro de jornada: everyone clocks, so everyone has it.
        { label: t('Working time', 'Registro de jornada'), to: '/jornada', perm: () => true, icon: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 4.6V8l2.4 1.5' },
        // Personal: the team's people, holidays and what waits for the owner
        // (pages/personal.vue). Owners only, as Turnos and Comisiones are.
        { label: t('Staff', 'Personal'), to: '/personal', perm: () => store.isOwner, icon: 'M2.5 3h11v10h-11zM6 6.6a1.4 1.4 0 102.8 0 1.4 1.4 0 00-2.8 0M4.6 11c.3-1.2 1.3-1.9 2.8-1.9s2.5.7 2.8 1.9M10.8 5.6h1.4M10.8 7.6h1.4' },
      ],
    },
    {
      id: 'money',
      label: t('Money', 'Dinero'),
      items: [
        { label: t('Billing', 'Facturación'), to: '/billing', perm: () => can('billing_access'), icon: 'M2 4h12v8h-12zM2 7h12' },
        { label: t('Reports', 'Informes'), to: '/reports', perm: () => can('reports_access'), icon: 'M2.4 8h2.6v5.6h-2.6zM6.7 4.6h2.6v9h-2.6zM11 6.6h2.6v7h-2.6z' },
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
        { label: t('Overview', 'Resumen'), to: '/growth', exact: true, perm: () => can('communication_config'), icon: 'M2 12.5V7m3.5 5.5V3.5M9 12.5V9m3.5 3.5V5.5' },
        { label: t('Leads', 'Leads'), to: '/growth/leads', perm: () => can('communication_config'), icon: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M6 6.5v6' },
        { label: t('AI receptionist', 'Recepcionista IA'), to: '/growth/receptionist', perm: () => can('communication_config'), icon: 'M4 5.5h8v5h-3l-2 2v-2h-3zM6.2 8h.01M9.8 8h.01' },
        { label: t('Reputation', 'Reputación'), to: '/growth/reputation', perm: () => can('communication_config'), icon: 'M8 1.8l1.8 3.7 4 .6-2.9 2.8.7 4L8 11l-3.6 1.9.7-4-2.9-2.8 4-.6z' },
      ],
    },
  ])

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
