<script setup lang="ts">
import type { NavBadge } from '~/composables/useNavBadges'
import type { SidebarNavItem } from '~/composables/useSidebarNavItems'

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const { can } = usePermission()
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
const automationsActive = ref(false)
const inboxUnreadCount = ref(0)
// Team messages keep their own count, live from useTeamChat's subscription
// (started by the layout), not from get_nav_badges.
const { unreadTotal: teamUnread } = useTeamChat()

// The recalls badge counts 3+ weeks since the last visit, in the clinic
// picked above -- the same default the Recalls page opens with, so the badge
// is the length of the list it links to. The threshold lives with the count,
// in get_nav_badges. Only what is the person's to do: recalls assigned to
// them or to nobody, not a colleague's.

// One token for the one request; a newer load discards an older answer.
const badgeTokens = { myday: 0 }
let lastFullLoad = 0
// The recalls count on its own, longer clock. Who is due a recall changes
// over days, and the count runs patient_visit_facts over every appointment
// the account has (~340 ms on production's database) -- it was asked on every
// return to the tab, hundreds of times a day. A refresh that names 'recalls'
// (snoozing someone on /recalls) still gets a fresh count at once.
const RECALLS_TTL_MS = 10 * 60_000
let lastRecallsLoad = 0
async function loadBadges(only: NavBadge[] | null = null) {
  // One request for all of them (get_nav_badges), whichever badge asked:
  // five requests fired together used to queue behind each other on the
  // database, and the heaviest of them, the Inbox count, answered in twice
  // the time it takes alone. `only` still matters for the recalls count,
  // which keeps its own clock: it is recomputed only when named, or when its
  // ten minutes are up.
  const wantRecalls = (!only ? Date.now() - lastRecallsLoad >= RECALLS_TTL_MS : only.includes('recalls')) && can('recalls_access')
  if (!only) lastFullLoad = Date.now()
  if (!store.teamMember) {
    await new Promise<void>((resolve) => {
      watch(() => store.teamMember, (v) => { if (v) resolve() }, { once: true })
    })
  }
  const token = ++badgeTokens.myday
  if (wantRecalls) lastRecallsLoad = Date.now()
  const { data } = await supabase.rpc('get_nav_badges' as never, {
    p_team_member_id: store.teamMember!.id,
    p_clinic_id: store.currentClinicId,
    p_recalls_clinic_id: store.currentClinicId && store.clinics.length > 1 ? store.currentClinicId : null,
    p_day_start: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
    p_day_end: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
    p_with_recalls: wantRecalls,
  } as never)
  if (token !== badgeTokens.myday) return
  const badges = (data ?? {}) as { my_day?: number; automations_active?: boolean; inbox_unread?: number; support_unread?: boolean; recalls?: number | null; recalls_mine?: number | null }
  myDayCount.value = badges.my_day ?? 0
  if (can('communication_config')) automationsActive.value = badges.automations_active ?? false
  if (can('inbox_access')) inboxUnreadCount.value = badges.inbox_unread ?? 0
  supportUnread.value = badges.support_unread ?? false
  if (wantRecalls && typeof badges.recalls === 'number') recallsCount.value = badges.recalls
  if (wantRecalls && typeof badges.recalls === 'number') recallsMine.value = badges.recalls_mine ?? 0
}

const NAV_BADGES_TTL_MS = 60_000
const { request: badgesRequest, supportUnread, recallsMine } = useNavBadges()
function onVisible() {
  if (document.visibilityState === 'visible') loadBadges()
}
onMounted(() => {
  loadBadges()
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible))
watch(() => route.path, () => {
  if (Date.now() - lastFullLoad >= NAV_BADGES_TTL_MS) loadBadges()
})
// Another clinic is another count: asked at once, whatever the clock says.
watch(() => store.currentClinicId, () => {
  lastRecallsLoad = 0
  loadBadges()
})
watch(() => badgesRequest.value.seq, () => loadBadges(badgesRequest.value.only))

const { visibleGroups } = useSidebarNavItems()

function isActive(to: string, exact = false) {
  // Most items are section roots -- /reports should stay lit on
  // /reports/income -- so a prefix match is the default. `exact` opts out for
  // the ones that are a page rather than a section.
  if (exact) return route.path === to
  return route.path === to || route.path.startsWith(`${to}/`)
}

function groupOpen(group: { id: string; items: SidebarNavItem[] }) {
  // Collapsed to icons there is no heading to reopen a group from, so every
  // icon shows.
  if (collapsed.value) return true
  return !closedGroups.value.has(group.id) || group.items.some((i) => isActive(i.to, i.exact))
}

/** The badge as words, for a collapsed item's accessible name and tooltip. */
function badgeText(item: SidebarNavItem): string | null {
  if (item.badge === 'myday' && myDayCount.value > 0) return t(`${myDayCount.value} today`, `${myDayCount.value} hoy`)
  if (item.badge === 'recalls' && recallsCount.value > 0) return t(`${recallsCount.value} to contact`, `${recallsCount.value} por contactar`)
  if (item.badge === 'inbox' && inboxUnreadCount.value > 0) return t(`${inboxUnreadCount.value} unread`, `${inboxUnreadCount.value} sin leer`)
  if (item.badge === 'team' && teamUnread.value > 0) return t(`${teamUnread.value} unread`, `${teamUnread.value} sin leer`)
  if (item.badge === 'automations' && automationsActive.value) return t('running', 'activas')
  return null
}
function itemName(item: SidebarNavItem) {
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

// Eighteen items do not fit a 900px-tall window, and the list scrolled with
// nothing to say so: the last three were simply not there. While anything
// sits below the fold, the bottom edge fades and a chevron points down.
const navRef = ref<HTMLElement | null>(null)
const moreBelow = ref(false)
function measureNav() {
  const el = navRef.value
  moreBelow.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4
}
function scrollNavDown() {
  navRef.value?.scrollBy({ top: navRef.value.clientHeight * 0.6, behavior: smoothScroll() })
}
let navObserver: ResizeObserver | undefined
onMounted(() => {
  if (!navRef.value) return
  navObserver = new ResizeObserver(measureNav)
  navObserver.observe(navRef.value)
  measureNav()
})
// A group folded or opened, or a badge appeared: the content changed height.
onUpdated(() => nextTick(measureNav))
onUnmounted(() => navObserver?.disconnect())
</script>


<template>
  <div v-if="props.open" class="fixed inset-0 z-30 bg-scrim/40 lg:hidden" @click="emit('close')" />

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
          <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-brand-tint text-[11px] font-bold text-brand">{{ clinicInitials }}</span>
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

    <div class="relative flex min-h-0 flex-1 flex-col">
      <nav ref="navRef" :aria-label="t('Main', 'Principal')" class="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-3 pt-0.5" :class="{ 'items-center gap-2 px-1.5': collapsed }" @scroll.passive="measureNav">
        <div v-for="(group, gi) in visibleGroups" :key="group.id" class="flex flex-col gap-0.5" :class="{ 'items-center': collapsed }" :data-cy="`nav-group-${group.id}`">
          <button
            v-if="!collapsed"
            type="button"
            class="group/heading flex min-h-7 items-center gap-[7px] rounded-ctlSm px-[9px] py-1 text-left hover:bg-surface-sidebarHover touch:min-h-11"
            :aria-expanded="groupOpen(group)"
            :data-cy="`nav-group-toggle-${group.id}`"
            @click="toggleGroup(group.id)"
          >
            <span class="text-[11px] font-[640] uppercase tracking-[.07em]" :class="group.tier ? 'text-brand-text' : 'text-ink-faint'">{{ group.label }}</span>
            <span
              v-if="group.tier"
              class="rounded-pill bg-brand px-1.5 py-px text-[11px] font-bold uppercase leading-none tracking-[.06em] text-surface"
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
                <span v-if="item.badge === 'recalls' && recallsCount > 0" class="rounded-pill bg-chip-bg px-1.5 py-px text-[11px] font-semibold text-ink-700" data-cy="nav-badge-recalls">{{ recallsCount }}</span>
                <span v-if="item.badge === 'automations' && automationsActive" class="h-[5px] w-[5px] rounded-full bg-success-accent" data-cy="nav-badge-automations" />
                <span v-if="item.badge === 'inbox' && inboxUnreadCount > 0" class="rounded-pill bg-brand px-1.5 py-px text-[11px] font-semibold text-surface" data-cy="nav-badge-inbox">{{ inboxUnreadCount }}</span>
                <span v-if="item.badge === 'team' && teamUnread > 0" class="rounded-pill bg-brand px-1.5 py-px text-[11px] font-semibold text-surface" data-cy="nav-badge-team">{{ teamUnread }}</span>
              </template>
              <span v-else-if="badgeText(item)" class="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-brand" aria-hidden="true" />
            </NuxtLink>
          </template>
        </div>

        <div class="flex flex-col gap-0.5" :class="{ 'items-center': collapsed }">
          <div v-if="!collapsed" class="px-[9px] py-1 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Help & Support', 'Ayuda y soporte') }}</div>
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
      <!-- For the pointer only: the keyboard reaches every item by tabbing,
      and a screen reader reads the whole list either way. -->
      <div v-if="moreBelow" class="pointer-events-none absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-surface-sidebar to-transparent" data-cy="sidebar-more-below">
        <button type="button" tabindex="-1" aria-hidden="true" class="pointer-events-auto mb-0.5 flex h-6 w-8 items-center justify-center rounded-ctlSm text-ink-muted hover:bg-surface-sidebarHover" @click="scrollNavDown">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        </button>
      </div>
    </div>

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
