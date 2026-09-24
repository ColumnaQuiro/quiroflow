<script setup lang="ts">
const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const { can, scope } = usePermission()
const store = useAccountStore()
const supabase = useSupabaseClient()
const t = useT()

const { preference: langPreference } = useLang()
const helpCentreUrl = computed(() => (langPreference.value === 'es' ? 'https://learn.quiroflow.com/es' : 'https://learn.quiroflow.com'))
const referFriendsOpen = ref(false)

const clinicMenuOpen = ref(false)
const clinicMenuRef = ref<HTMLElement | null>(null)
function selectClinic(id: string) {
  store.setCurrentClinic(id)
  clinicMenuOpen.value = false
}

// Per-device UI preference (not per-user in the DB) -- purely a "give me
// more horizontal room" toggle, same spirit as the calendar's Display
// toggles, so it doesn't need to sync across devices.
const collapsed = ref(false)
// Server-rendered links work before hydration; the buttons here (collapse,
// group headings, clinic switcher) do not, so this says when they will.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
  collapsed.value = localStorage.getItem('quiroflow-sidebar-collapsed') === '1'
  try {
    closedGroups.value = new Set(JSON.parse(localStorage.getItem('quiroflow-sidebar-closed-groups') ?? '[]'))
  } catch {
    closedGroups.value = new Set()
  }
})
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem('quiroflow-sidebar-collapsed', collapsed.value ? '1' : '0')
}

// An owner sees nineteen items, which at 44px a row is taller than an iPad
// held landscape. Any group folds away from its heading, per device like the
// collapse above -- except the one holding the page you are on, which always
// shows, so folding can never hide where you are.
const closedGroups = ref(new Set<string>())
function toggleGroup(id: string) {
  const next = new Set(closedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  closedGroups.value = next
  localStorage.setItem('quiroflow-sidebar-closed-groups', JSON.stringify([...next]))
}

const recallsCount = ref(0)
const myDayCount = ref(0)
const campaignsActive = ref(false)
const inboxUnreadCount = ref(0)

// The same default the Recalls page opens with -- 3+ weeks since the last
// visit, in the clinic picked above -- so the badge is the length of the list
// it links to. It counted the whole account at any age, which on a
// two-clinic account is a number no screen ever shows.
const RECALLS_MIN_DAYS = 21

let badgeToken = 0
async function loadBadges() {
  const token = ++badgeToken
  // Each badge assigns its own count as its own query returns. They used to
  // share a Promise.all, so all four waited on the slowest and then appeared
  // in one jump -- the recalls and inbox numbers landing together is exactly
  // that, not a coincidence of timing.
  if (can('recalls_access')) {
    let recalls = supabase
      .from('recall_candidates')
      .select('patient_id', { count: 'exact', head: true })
      .gte('days_since_last_appointment', RECALLS_MIN_DAYS)
    if (store.currentClinicId && store.clinics.length > 1) recalls = recalls.or(`clinic_id.eq.${store.currentClinicId},clinic_id.is.null`)
    recalls.then(({ count }) => {
      if (token === badgeToken) recallsCount.value = count ?? 0
    })
  }

  if (can('communication_config')) {
    supabase
      .from('automation_rules')
      .select('id')
      .eq('enabled', true)
      .limit(1)
      .then(({ data }) => {
        if (token === badgeToken) campaignsActive.value = (data ?? []).length > 0
      })
  }

  // Only for someone who can open the Inbox. This ran for every team member
  // regardless, so a practitioner whose role has inbox_access off -- who
  // cannot see the nav item and now cannot reach the page -- was still
  // pulling 500 patient messages into their browser on every page load to
  // compute a badge they never see.
  if (can('inbox_access')) {
    supabase
      .from('whatsapp_messages')
      .select('patient_id, phone_number, direction, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        // A conversation counts as unread when the most recent message in it
        // is inbound (the patient sent last, staff hasn't replied since) --
        // no separate read/unread tracking exists yet, so this is derived.
        const seen = new Set<string>()
        let unread = 0
        for (const m of data ?? []) {
          const key = m.patient_id ?? m.phone_number ?? ''
          if (!key || seen.has(key)) continue
          seen.add(key)
          if (m.direction === 'inbound') unread++
        }
        if (token === badgeToken) inboxUnreadCount.value = unread
      })
  }

  // Only "My Day" needs the team member id, so it's the only one that waits
  // for the account store. A fresh client boot can reach this mount before
  // load() resolves store.teamMember -- an empty fallback here used to build
  // `practitioner_id=eq.` (no id at all), which Postgres rejects as a 400.
  if (!store.teamMember) {
    await new Promise<void>((resolve) => {
      watch(() => store.teamMember, (v) => { if (v) resolve() }, { once: true })
    })
  }
  // In the selected clinic, as /practitioner shows it.
  let myDay = supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('practitioner_id', store.teamMember!.id)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .gte('starts_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
    .lt('starts_at', new Date(new Date().setHours(24, 0, 0, 0)).toISOString())
  if (store.currentClinicId) myDay = myDay.eq('clinic_id', store.currentClinicId)
  const { count } = await myDay
  if (token === badgeToken) myDayCount.value = count ?? 0
}

// The sidebar mounts once, in the layout, so loading only on mount left every
// badge as it was when the app opened. See useNavBadges.
const { tick: badgesTick } = useNavBadges()
function onVisible() {
  if (document.visibilityState === 'visible') loadBadges()
}
onMounted(() => {
  loadBadges()
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible))
watch([() => route.path, () => store.currentClinicId, badgesTick], () => loadBadges())

interface NavItem {
  label: string
  to: string
  perm: () => boolean
  icon: string
  badge?: 'myday' | 'recalls' | 'campaigns' | 'inbox'
  /**
   * Highlight only on this exact path. For an item whose `to` is a prefix of
   * its siblings' -- /growth against /growth/leads -- without which both it
   * and the real destination light up at once.
   */
  exact?: boolean
}

const navGroups = computed<{ id: string; label: string; tier?: string; items: NavItem[] }[]>(() => [
  {
    id: 'today',
    label: t('Today', 'Hoy'),
    items: [
      { label: t('Dashboard', 'Panel'), to: '/dashboard', perm: () => scope('dashboard_scope') !== 'none', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
      { label: t('My Day', 'Mi día'), to: '/practitioner', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4', badge: 'myday' },
      { label: t('Calendar', 'Calendario'), to: '/calendar', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    ],
  },
  {
    id: 'patients',
    label: t('Patients', 'Pacientes'),
    items: [
      { label: t('Patients', 'Pacientes'), to: '/patients', perm: () => scope('patients_scope') !== 'none', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
      { label: t('Recalls', 'Recordatorios'), to: '/recalls', perm: () => can('recalls_access'), icon: 'M8 8m5.3 0a5.3 5.3 0 11-10.6 0 5.3 5.3 0 0110.6 0z', badge: 'recalls' },
      // Reuses recalls_access rather than a new permission key -- both are
      // patient-outreach lists with the same "who should staff be allowed to
      // see this" shape, and a brand new key would default to owner-only
      // until someone visits Settings > Roles to grant it, hiding the feature
      // from every non-owner account until then.
      { label: t('Waitlist', 'Lista de espera'), to: '/waitlist', perm: () => can('recalls_access'), icon: 'M8 2a6 6 0 100 12A6 6 0 008 2zM8 5v3.2l2.2 1.3' },
      { label: t('Care Plan Alerts', 'Alertas de plan'), to: '/care-plan-alerts', perm: () => can('recalls_access'), icon: 'M8 1.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.2 4.6 12l.7-3.8-2.8-2.7 3.8-.5z' },
      { label: t('Inbox', 'Bandeja de entrada'), to: '/inbox', perm: () => can('inbox_access'), icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z', badge: 'inbox' },
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
    // The one group carrying a tier badge -- everything under it is either
    // already included in every plan (Campaigns) or part of the paid Growth
    // tier, and the badge is what tells the two apart at a glance.
    tier: 'GROWTH',
    // No "Conversations" here any more. It was a second link to /inbox
    // (?ai=handling) that could never show as the page you were on, and did
    // nothing when clicked from the inbox itself, which reads the query only
    // on mount. The inbox's own "AI handling" chip is the same view.
    items: [
      // "Overview", not a second "Dashboard": collapsed, or read aloud, two
      // items with one name are indistinguishable.
      { label: t('Overview', 'Resumen'), to: '/growth', exact: true, perm: () => can('communication_config'), icon: 'M2 12.5V7m3.5 5.5V3.5M9 12.5V9m3.5 3.5V5.5' },
      { label: t('Leads', 'Contactos'), to: '/growth/leads', perm: () => can('communication_config'), icon: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M6 6.5v6' },
      { label: t('AI Receptionist', 'Recepcionista IA'), to: '/growth/receptionist', perm: () => can('communication_config'), icon: 'M4 5.5h8v5h-3l-2 2v-2h-3zM6.2 8h.01M9.8 8h.01' },
      { label: t('Automations', 'Automatizaciones'), to: '/growth/automations', perm: () => can('communication_config'), icon: 'M3 3.5h4v3h-4zM9 9.5h4v3h-4zM5 6.5v3h4' },
      { label: t('Reputation', 'Reputación'), to: '/growth/reputation', perm: () => can('communication_config'), icon: 'M8 1.8l1.8 3.7 4 .6-2.9 2.8.7 4L8 11l-3.6 1.9.7-4-2.9-2.8 4-.6z' },
      { label: t('Campaigns', 'Campañas'), to: '/campaigns', perm: () => can('communication_config'), icon: 'M8 2l4.5 6H8.9l1.1 6L5.5 8h3.6z', badge: 'campaigns' },
    ],
  },
])

const visibleGroups = computed(() =>
  navGroups.value.map((g) => ({ ...g, items: g.items.filter((i) => i.perm()) })).filter((g) => g.items.length > 0),
)

function isActive(to: string, exact = false) {
  // Most items are section roots -- /reports should stay lit on
  // /reports/income -- so a prefix match is the default. `exact` opts out for
  // the ones that are a page rather than a section.
  if (exact) return route.path === to
  return route.path === to || route.path.startsWith(`${to}/`)
}

function groupOpen(group: { id: string; items: NavItem[] }) {
  // Collapsed to icons there is no heading to reopen a group from, so every
  // icon shows.
  if (collapsed.value) return true
  return !closedGroups.value.has(group.id) || group.items.some((i) => isActive(i.to, i.exact))
}

/** The badge as words, for a collapsed item's accessible name and tooltip. */
function badgeText(item: NavItem): string | null {
  if (item.badge === 'myday' && myDayCount.value > 0) return t(`${myDayCount.value} today`, `${myDayCount.value} hoy`)
  if (item.badge === 'recalls' && recallsCount.value > 0) return t(`${recallsCount.value} to contact`, `${recallsCount.value} por contactar`)
  if (item.badge === 'inbox' && inboxUnreadCount.value > 0) return t(`${inboxUnreadCount.value} awaiting reply`, `${inboxUnreadCount.value} sin responder`)
  if (item.badge === 'campaigns' && campaignsActive.value) return t('running', 'activas')
  return null
}
function itemName(item: NavItem) {
  const b = badgeText(item)
  return b ? `${item.label} · ${b}` : item.label
}

const clinicInitials = computed(() => {
  const name = store.currentClinic?.name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'CL'
})

function onDocumentClick(e: MouseEvent) {
  if (clinicMenuOpen.value && clinicMenuRef.value && !clinicMenuRef.value.contains(e.target as Node)) {
    clinicMenuOpen.value = false
  }
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

// Below the lg breakpoint the sidebar is an off-canvas drawer (opened via
// the top bar's hamburger button) instead of a permanent column -- a phone
// doesn't have the width to spare for it at any collapsed/expanded size.
// Any navigation should dismiss it, same as clicking the backdrop.
watch(() => route.fullPath, () => emit('close'))
</script>


<template>
  <div v-if="props.open" class="fixed inset-0 z-30 bg-ink-900/40 lg:hidden" @click="emit('close')" />

  <aside
    data-cy="sidebar"
    :data-collapsed="collapsed ? 'true' : 'false'"
    :data-ready="hydrated ? 'true' : undefined"
    class="fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col bg-surface-sidebar border-r border-line transition-transform duration-200 print:hidden lg:static lg:z-auto lg:translate-x-0"
    :class="[props.open ? 'translate-x-0' : '-translate-x-full', collapsed ? 'lg:w-[60px] touch:lg:w-[68px]' : 'lg:w-[236px]']"
  >
    <div class="flex items-center gap-[9px] px-4 pb-3 pt-4" :class="{ 'justify-center px-0': collapsed }">
      <div class="flex h-6 w-6 items-center justify-center rounded-ctlSm bg-brand">
        <img src="/logo/quiroflow-mark-white.svg" alt="" class="h-3.5 w-3.5" />
      </div>
      <NuxtLink v-if="!collapsed" to="/dashboard" class="flex-1 text-[14.5px] font-[640] tracking-tightTitle text-ink-900">QuiroFlow</NuxtLink>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-sidebarHover touch:h-11 touch:w-11 lg:hidden"
        :aria-label="t('Close menu', 'Cerrar menú')"
        @click="emit('close')"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
      </button>
    </div>

    <!-- Collapsed, the switcher used to disappear altogether, so changing
    clinic meant expanding the sidebar first. It shrinks to its initials
    instead and opens the same menu beside it. -->
    <div v-if="store.clinics.length > 0" class="flex flex-col gap-1.5 pb-2.5" :class="collapsed ? 'items-center px-1.5' : 'px-3'">
      <div ref="clinicMenuRef" class="relative" :class="{ 'w-full': !collapsed }">
        <button
          type="button"
          data-cy="clinic-switcher"
          class="flex items-center gap-2 rounded-ctl border border-chip-border bg-surface text-left text-[13px] text-ink-700"
          :class="[
            collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-[34px] w-full px-2.5 touch:h-11',
            store.clinics.length > 1 ? 'hover:border-line-controlHover' : 'cursor-default',
          ]"
          :aria-label="collapsed || store.clinics.length > 1 ? t(`Clinic: ${store.currentClinic?.name ?? ''}`, `Clínica: ${store.currentClinic?.name ?? ''}`) : undefined"
          :title="collapsed ? store.currentClinic?.name : undefined"
          :aria-haspopup="store.clinics.length > 1 ? 'menu' : undefined"
          :aria-expanded="store.clinics.length > 1 ? clinicMenuOpen : undefined"
          @click="store.clinics.length > 1 && (clinicMenuOpen = !clinicMenuOpen)"
        >
          <span class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-brand-tint text-[9.5px] font-bold text-brand">{{ clinicInitials }}</span>
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1 truncate">{{ store.currentClinic?.name ?? t('Clinic', 'Clínica') }}</span>
            <svg v-if="store.clinics.length > 1" width="10" height="10" viewBox="0 0 10 10" class="shrink-0 text-ink-faint" aria-hidden="true"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
          </template>
        </button>
        <div
          v-if="clinicMenuOpen"
          role="menu"
          data-cy="clinic-menu"
          class="absolute z-20 min-w-[200px] rounded-ctl border border-line bg-surface py-1 shadow-popover"
          :class="collapsed ? 'left-full top-0 ml-2' : 'left-0 top-full mt-1 w-full'"
        >
          <button
            v-for="c in store.clinics"
            :key="c.id"
            type="button"
            role="menuitemradio"
            :aria-checked="c.id === store.currentClinicId"
            class="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-subtle touch:min-h-11"
            :class="c.id === store.currentClinicId ? 'text-brand-text font-medium' : 'text-ink-600'"
            @click="selectClinic(c.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
            <svg v-if="c.id === store.currentClinicId" width="12" height="12" viewBox="0 0 12 12" class="shrink-0" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      </div>
    </div>

    <nav :aria-label="t('Main', 'Principal')" class="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-3 pt-0.5" :class="{ 'items-center gap-2 px-1.5': collapsed }">
      <div v-for="(group, gi) in visibleGroups" :key="group.id" class="flex flex-col gap-0.5" :class="{ 'items-center': collapsed }" :data-cy="`nav-group-${group.id}`">
        <button
          v-if="!collapsed"
          type="button"
          class="group/heading flex min-h-7 items-center gap-[7px] rounded-ctlSm px-[9px] py-1 text-left hover:bg-surface-sidebarHover touch:min-h-11"
          :aria-expanded="groupOpen(group)"
          :data-cy="`nav-group-toggle-${group.id}`"
          @click="toggleGroup(group.id)"
        >
          <span class="text-[10.5px] font-[640] uppercase tracking-[.07em]" :class="group.tier ? 'text-brand-text' : 'text-ink-faint'">{{ group.label }}</span>
          <span
            v-if="group.tier"
            class="rounded-pill bg-brand px-1.5 py-px text-[8.5px] font-bold uppercase leading-none tracking-[.06em] text-surface"
          >{{ group.tier }}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            class="ml-auto shrink-0 text-ink-faint transition-transform"
            :class="[groupOpen(group) ? '' : '-rotate-90', 'opacity-0 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100 touch:opacity-100']"
            aria-hidden="true"
          ><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
        </button>
        <div v-else-if="gi > 0" class="mb-1 h-px w-6 bg-line" aria-hidden="true" />
        <template v-if="groupOpen(group)">
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            data-cy="nav-item"
            :data-to="item.to"
            class="relative flex items-center gap-[9px] rounded-ctlSm text-[13.5px]"
            :class="[
              collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-8 w-full px-[9px] touch:h-11',
              isActive(item.to, item.exact) ? 'bg-brand-tint text-brand-text font-semibold' : 'text-ink-600 hover:bg-surface-sidebarHover',
            ]"
            :aria-current="isActive(item.to, item.exact) ? 'page' : undefined"
            :aria-label="collapsed ? itemName(item) : undefined"
            :title="collapsed ? itemName(item) : undefined"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path :d="item.icon" /></svg>
            <template v-if="!collapsed">
              <span class="flex-1">{{ item.label }}</span>
              <span v-if="item.badge === 'myday' && myDayCount > 0" class="font-mono text-[11px] text-ink-muted2" data-cy="nav-badge-myday">{{ myDayCount }}</span>
              <!-- Neutral, not red: red is money owed everywhere else in the
              app, and a list of people to call is work, not an alarm. -->
              <span v-if="item.badge === 'recalls' && recallsCount > 0" class="rounded-pill bg-chip-bg px-1.5 py-px text-[10.5px] font-semibold text-ink-700" data-cy="nav-badge-recalls">{{ recallsCount }}</span>
              <span v-if="item.badge === 'campaigns' && campaignsActive" class="h-[5px] w-[5px] rounded-full bg-success-accent" data-cy="nav-badge-campaigns" />
              <span v-if="item.badge === 'inbox' && inboxUnreadCount > 0" class="rounded-pill bg-brand px-1.5 py-px text-[10.5px] font-semibold text-surface" data-cy="nav-badge-inbox">{{ inboxUnreadCount }}</span>
            </template>
            <span v-else-if="badgeText(item)" class="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-brand" aria-hidden="true" />
          </NuxtLink>
        </template>
      </div>

      <div class="flex flex-col gap-0.5" :class="{ 'items-center': collapsed }">
        <div v-if="!collapsed" class="px-[9px] py-1 text-[10.5px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Help & Support', 'Ayuda y soporte') }}</div>
        <div v-else class="mb-1 h-px w-6 bg-line" aria-hidden="true" />
        <a
          :href="helpCentreUrl"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-[9px] rounded-ctlSm text-[13.5px] text-ink-600 hover:bg-surface-sidebarHover"
          :class="collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-8 w-full px-[9px] touch:h-11'"
          :aria-label="collapsed ? t('Help Centre', 'Centro de ayuda') : undefined"
          :title="collapsed ? t('Help Centre', 'Centro de ayuda') : undefined"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.8" /><path d="M6.2 6.3a1.8 1.8 0 013.4.8c0 1.2-1.6 1.4-1.6 2.5" stroke-linecap="round" /><circle cx="8" cy="11.5" r="0.15" fill="currentColor" /></svg>
          <span v-if="!collapsed" class="flex-1">{{ t('Help Centre', 'Centro de ayuda') }}</span>
        </a>
        <button
          type="button"
          class="flex items-center gap-[9px] rounded-ctlSm text-[13.5px] text-ink-600 hover:bg-surface-sidebarHover"
          :class="collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-8 w-full px-[9px] touch:h-11'"
          :aria-label="collapsed ? t('Refer Your Friends!', '¡Recomienda a tus amigos!') : undefined"
          :title="collapsed ? t('Refer Your Friends!', '¡Recomienda a tus amigos!') : undefined"
          @click="referFriendsOpen = true"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.8" /><path d="M8 4.8v6.4M6 6.5c0-.9.9-1.5 2-1.5s2 .5 2 1.3c0 1.7-4 .9-4 2.7 0 .8.9 1.3 2 1.3s2-.6 2-1.5" stroke-linecap="round" /></svg>
          <span v-if="!collapsed" class="flex-1 text-left">{{ t('Refer Your Friends!', '¡Recomienda a tus amigos!') }}</span>
        </button>
      </div>
    </nav>

    <!-- Settings is no longer the last thing in the column. Pinned to the
    bottom-left corner, it sat exactly where Chrome draws a hovered link's
    URL, so pointing at Settings covered Settings with its own address. The
    collapse control takes the corner instead: a button, which has no URL to
    show. It used to be a 24px circle floating on the border, too small to
    hit with a finger. -->
    <div class="flex flex-col gap-0.5 border-t border-line px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5" :class="{ 'items-center px-1.5': collapsed }">
      <NuxtLink
        v-if="can('settings_access')"
        to="/settings"
        data-cy="nav-settings"
        class="flex items-center gap-[9px] rounded-ctlSm text-[13.5px]"
        :class="[
          collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-8 w-full px-[9px] touch:h-11',
          isActive('/settings') ? 'bg-brand-tint text-brand-text font-semibold' : 'text-ink-600 hover:bg-surface-sidebarHover',
        ]"
        :aria-current="isActive('/settings') ? 'page' : undefined"
        :aria-label="collapsed ? t('Settings', 'Ajustes') : undefined"
        :title="collapsed ? t('Settings', 'Ajustes') : undefined"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.3" /><circle cx="8" cy="8" r="1.9" /></svg>
        <span v-if="!collapsed" class="flex-1">{{ t('Settings', 'Ajustes') }}</span>
      </NuxtLink>
      <!-- Desktop-only -- the mobile drawer doesn't have a collapsed state. -->
      <button
        type="button"
        data-cy="sidebar-collapse"
        class="hidden items-center gap-[9px] rounded-ctlSm text-[13px] text-ink-muted2 hover:bg-surface-sidebarHover hover:text-ink-700 lg:flex"
        :class="collapsed ? 'h-9 w-9 justify-center touch:h-11 touch:w-11' : 'h-8 w-full px-[9px] touch:h-11'"
        :aria-label="collapsed ? t('Expand sidebar', 'Expandir barra lateral') : undefined"
        :aria-expanded="!collapsed"
        :title="collapsed ? t('Expand sidebar', 'Expandir barra lateral') : undefined"
        @click="toggleCollapsed"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M6 2.5v11" />
          <path v-if="collapsed" d="M8.6 6.5L10.2 8l-1.6 1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path v-else d="M10.2 6.5L8.6 8l1.6 1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span v-if="!collapsed" class="flex-1 text-left">{{ t('Collapse', 'Contraer') }}</span>
      </button>
    </div>

    <ReferFriendsModal v-if="referFriendsOpen" @close="referFriendsOpen = false" />
  </aside>
</template>
