<script setup lang="ts">
const route = useRoute()
const { can, scope } = usePermission()
const store = useAccountStore()
const supabase = useSupabaseClient()
const t = useT()

const paletteOpen = ref(false)
const accountMenuOpen = ref(false)
const accountMenuRef = ref<HTMLElement | null>(null)
const cashShiftOpen = ref(false)

// Per-device UI preference (not per-user in the DB) -- purely a "give me
// more horizontal room" toggle, same spirit as the calendar's Display
// toggles, so it doesn't need to sync across devices.
const collapsed = ref(false)
onMounted(() => {
  collapsed.value = localStorage.getItem('quiroflow-sidebar-collapsed') === '1'
})
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem('quiroflow-sidebar-collapsed', collapsed.value ? '1' : '0')
}

const recallsCount = ref(0)
const myDayCount = ref(0)
const campaignsActive = ref(false)
const inboxUnreadCount = ref(0)

async function loadBadges() {
  // A fresh client boot can reach this mount before the account store's own
  // load() resolves store.teamMember -- an empty fallback here used to build
  // `practitioner_id=eq.` (no id at all), which Postgres rejects as a 400.
  if (!store.teamMember) {
    await new Promise<void>((resolve) => {
      watch(() => store.teamMember, (v) => { if (v) resolve() }, { once: true })
    })
  }
  const [{ count: recalls }, { count: myDay }, { data: campaigns }, { data: recentMessages }] = await Promise.all([
    supabase.from('recall_candidates').select('patient_id', { count: 'exact', head: true }),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('practitioner_id', store.teamMember!.id)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .gte('starts_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .lt('starts_at', new Date(new Date().setHours(24, 0, 0, 0)).toISOString()),
    supabase.from('automation_rules').select('id').eq('enabled', true).limit(1),
    supabase.from('whatsapp_messages').select('patient_id, phone_number, direction, created_at').order('created_at', { ascending: false }).limit(500),
  ])
  recallsCount.value = recalls ?? 0
  myDayCount.value = myDay ?? 0
  campaignsActive.value = (campaigns ?? []).length > 0

  // A conversation counts as unread when the most recent message in it is
  // inbound (the patient sent last, staff hasn't replied since) -- no
  // separate read/unread tracking exists yet, so this is derived.
  const seen = new Set<string>()
  let unread = 0
  for (const m of recentMessages ?? []) {
    const key = m.patient_id ?? m.phone_number ?? ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (m.direction === 'inbound') unread++
  }
  inboxUnreadCount.value = unread
}
onMounted(loadBadges)

interface NavItem {
  label: string
  to: string
  perm: () => boolean
  icon: string
  badge?: 'myday' | 'recalls' | 'campaigns' | 'inbox'
}

const navGroups = computed<{ label: string; items: NavItem[] }[]>(() => [
  {
    label: t('Today', 'Hoy'),
    items: [
      { label: t('Dashboard', 'Panel'), to: '/dashboard', perm: () => scope('dashboard_scope') !== 'none', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
      { label: t('My Day', 'Mi día'), to: '/practitioner', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 2.5h11v11h-11zM5.5 8.2l1.8 1.8 3.2-3.4', badge: 'myday' },
      { label: t('Calendar', 'Calendario'), to: '/calendar', perm: () => scope('calendar_scope') !== 'none', icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
    ],
  },
  {
    label: t('Patients', 'Pacientes'),
    items: [
      { label: t('Patients', 'Pacientes'), to: '/patients', perm: () => scope('patients_scope') !== 'none', icon: 'M6.2 5.6a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0zM2 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6' },
      { label: t('Recalls', 'Recordatorios'), to: '/recalls', perm: () => can('recalls_access'), icon: 'M8 8m5.3 0a5.3 5.3 0 11-10.6 0 5.3 5.3 0 0110.6 0z', badge: 'recalls' },
      { label: t('Inbox', 'Bandeja de entrada'), to: '/inbox', perm: () => can('inbox_access'), icon: 'M2 3.5h12v9h-8l-3 2.5v-2.5h-1z', badge: 'inbox' },
    ],
  },
  {
    label: t('Money', 'Dinero'),
    items: [
      { label: t('Billing', 'Facturación'), to: '/billing', perm: () => can('billing_access'), icon: 'M2 4h12v8h-12zM2 7h12' },
      { label: t('Reports', 'Informes'), to: '/reports', perm: () => can('reports_access'), icon: 'M2.4 8h2.6v5.6h-2.6zM6.7 4.6h2.6v9h-2.6zM11 6.6h2.6v7h-2.6z' },
    ],
  },
  {
    label: t('Growth', 'Crecimiento'),
    items: [
      { label: t('Campaigns', 'Campañas'), to: '/campaigns', perm: () => can('communication_config'), icon: 'M8 2l4.5 6H8.9l1.1 6L5.5 8h3.6z', badge: 'campaigns' },
    ],
  },
])

const visibleGroups = computed(() =>
  navGroups.value.map((g) => ({ ...g, items: g.items.filter((i) => i.perm()) })).filter((g) => g.items.length > 0),
)

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

const initials = computed(() => {
  const name = store.teamMember?.full_name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
})
const clinicInitials = computed(() => {
  const name = store.currentClinic?.name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'CL'
})
const roleLine = computed(() => (store.teamMember?.is_owner ? t('Owner', 'Propietario') : store.teamMember?.role === 'front_desk' ? t('Front Desk', 'Recepción') : t('Practitioner', 'Profesional')))

function onDocumentClick(e: MouseEvent) {
  if (accountMenuOpen.value && accountMenuRef.value && !accountMenuRef.value.contains(e.target as Node)) {
    accountMenuOpen.value = false
  }
}
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = true
  }
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

async function signOut() {
  await supabase.auth.signOut()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <aside class="flex shrink-0 flex-col bg-surface-sidebar border-r border-line print:hidden" :class="collapsed ? 'w-[60px]' : 'w-[236px]'">
    <div class="flex items-center gap-[9px] px-4 pb-3 pt-4" :class="{ 'justify-center px-0': collapsed }">
      <div class="flex h-6 w-6 items-center justify-center rounded-ctlSm bg-brand">
        <img src="/logo/quiroflow-mark-white.svg" alt="" class="h-3.5 w-3.5" />
      </div>
      <NuxtLink v-if="!collapsed" to="/dashboard" class="text-[14.5px] font-[640] tracking-tightTitle text-ink-900">QuiroFlow</NuxtLink>
    </div>

    <div class="flex flex-col gap-1.5 px-3 pb-2.5" :class="{ 'items-center px-1.5': collapsed }">
      <button
        v-if="store.clinics.length > 0 && !collapsed"
        type="button"
        class="flex h-[34px] items-center gap-2 rounded-ctl border border-chip-border bg-surface px-2.5 text-left text-[13px] text-ink-700 hover:border-line-controlHover"
      >
        <span class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-brand-tint text-[9.5px] font-bold text-brand">{{ clinicInitials }}</span>
        <span class="min-w-0 flex-1 truncate">{{ store.currentClinic?.name ?? t('Clinic', 'Clínica') }}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" class="shrink-0 text-ink-faint"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
      </button>
      <button
        type="button"
        class="flex h-8 items-center gap-2 rounded-ctl bg-chip text-left text-[13px] text-ink-muted hover:bg-surface-subtle"
        :class="collapsed ? 'w-8 justify-center' : 'w-full px-2.5'"
        :title="collapsed ? t('Search or jump to (⌘K)', 'Buscar o ir a (⌘K)') : undefined"
        @click="paletteOpen = true"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" class="shrink-0"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        <template v-if="!collapsed">
          <span class="flex-1">{{ t('Search or jump to', 'Buscar o ir a') }}</span>
          <span class="rounded border border-line-control bg-surface px-1 py-px font-mono text-[10.5px] text-ink-faint2">⌘K</span>
        </template>
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-3 pt-0.5" :class="{ 'items-center px-1.5': collapsed }">
      <div v-for="group in visibleGroups" :key="group.label" class="flex flex-col gap-0.5" :class="{ 'items-center': collapsed }">
        <div v-if="!collapsed" class="px-[9px] py-1 text-[10.5px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ group.label }}</div>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="relative flex h-8 items-center gap-[9px] rounded-ctlSm text-[13.5px]"
          :class="[collapsed ? 'w-8 justify-center' : 'w-full px-[9px]', isActive(item.to) ? 'bg-brand-tint text-brand-text font-semibold' : 'text-ink-600 hover:bg-surface-subtle']"
          :title="collapsed ? item.label : undefined"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path :d="item.icon" /></svg>
          <template v-if="!collapsed">
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.badge === 'myday' && myDayCount > 0" class="font-mono text-[11px] text-ink-muted2">{{ myDayCount }}</span>
            <span v-if="item.badge === 'recalls' && recallsCount > 0" class="rounded-pill bg-danger-bg px-1.5 py-px text-[10.5px] font-semibold text-danger-text">{{ recallsCount }}</span>
            <span v-if="item.badge === 'campaigns' && campaignsActive" class="h-[5px] w-[5px] rounded-full bg-success-accent" />
            <span v-if="item.badge === 'inbox' && inboxUnreadCount > 0" class="rounded-pill bg-brand px-1.5 py-px text-[10.5px] font-semibold text-white">{{ inboxUnreadCount }}</span>
          </template>
          <span v-else-if="(item.badge === 'myday' && myDayCount > 0) || (item.badge === 'recalls' && recallsCount > 0) || (item.badge === 'campaigns' && campaignsActive) || (item.badge === 'inbox' && inboxUnreadCount > 0)" class="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-danger-text" />
        </NuxtLink>
      </div>
    </nav>

    <div class="flex flex-col gap-0.5 border-t border-line px-3 py-2.5" :class="{ 'items-center px-1.5': collapsed }">
      <button
        type="button"
        class="flex h-8 items-center gap-[9px] rounded-ctlSm text-[13px] text-ink-muted2 hover:bg-surface-subtle"
        :class="collapsed ? 'w-8 justify-center' : 'w-full px-[9px]'"
        :title="collapsed ? t('Expand sidebar', 'Expandir barra lateral') : undefined"
        @click="toggleCollapsed"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M6.2 2.5v11" />
          <path v-if="collapsed" d="M9.5 6.2l2 1.8-2 1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path v-else d="M11.5 6.2l-2 1.8 2 1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span v-if="!collapsed" class="flex-1 text-left">{{ t('Collapse sidebar', 'Colapsar barra lateral') }}</span>
      </button>

      <NuxtLink
        v-if="can('settings_access')"
        to="/settings"
        class="flex h-8 items-center gap-[9px] rounded-ctlSm text-[13.5px]"
        :class="[collapsed ? 'w-8 justify-center' : 'w-full px-[9px]', isActive('/settings') ? 'bg-brand-tint text-brand-text font-semibold' : 'text-ink-600 hover:bg-surface-subtle']"
        :title="collapsed ? t('Settings', 'Ajustes') : undefined"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.3" /><circle cx="8" cy="8" r="1.9" /></svg>
        <span v-if="!collapsed" class="flex-1">{{ t('Settings', 'Ajustes') }}</span>
      </NuxtLink>

      <div ref="accountMenuRef" class="relative w-full" :class="{ 'flex justify-center': collapsed }">
        <button
          type="button"
          class="flex h-10 items-center gap-[9px] rounded-ctlSm text-left hover:bg-surface-subtle"
          :class="collapsed ? 'w-8 justify-center' : 'w-full px-2'"
          :title="collapsed ? (store.teamMember?.full_name ?? t('Account', 'Cuenta')) : undefined"
          @click="accountMenuOpen = !accountMenuOpen"
        >
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{{ initials }}</span>
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12.5px] font-medium text-ink-700">{{ store.teamMember?.full_name }}</span>
              <span class="block text-[11px] text-ink-muted2">{{ roleLine }}</span>
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" class="shrink-0 text-ink-faint"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
          </template>
        </button>
        <div
          v-if="accountMenuOpen"
          class="absolute bottom-full z-20 mb-1 w-max min-w-[180px] rounded-ctl border border-line bg-surface py-1 shadow-popover"
          :class="collapsed ? 'left-full ml-1' : 'left-0 w-full'"
        >
          <NuxtLink to="/account" class="block px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle" @click="accountMenuOpen = false">
            {{ t('Account Settings', 'Ajustes de la cuenta') }}
          </NuxtLink>
          <button
            v-if="can('payments_allocate')"
            type="button"
            class="block w-full px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle"
            @click="cashShiftOpen = true; accountMenuOpen = false"
          >
            {{ t('Cash Shift', 'Turno de caja') }}
          </button>
          <button type="button" class="block w-full px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle" @click="signOut">
            {{ t('Sign out', 'Cerrar sesión') }}
          </button>
        </div>
      </div>
    </div>

    <AppCommandPalette v-if="paletteOpen" @close="paletteOpen = false" />
    <CashShiftModal v-if="cashShiftOpen" @close="cashShiftOpen = false" />
  </aside>
</template>
