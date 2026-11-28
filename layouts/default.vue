<script setup lang="ts">
// Deliberately started but not awaited. A top-level await makes the whole
// layout an async component, so Vue suspended it -- and every child -- on
// each navigation.
//
// It can't be dropped entirely either: middleware/account.global.ts bails
// early on `if (!user.value) return`, and immediately after login
// useSupabaseUser() hasn't populated yet, so the middleware skips the load
// on exactly the navigation that lands on the dashboard. Removing this left
// the sidebar with no account name (caught by the login e2e spec). Kicking
// it off without blocking keeps that safety net: the shell renders straight
// away and the store's values fill in reactively when it resolves.
const store = useAccountStore()
if (!store.loaded && !store.loading) store.load()

const t = useT()
const route = useRoute()
const router = useRouter()
const showDenied = ref(route.query.denied === '1')

// The router's own route, not useRoute(). In a layout, useRoute() is the route
// of the page on screen, and it only moves once the next page has rendered.
const currentPath = computed(() => router.currentRoute.value.path)

// Used to live in the sidebar, costing it a full row of width every screen
// for a control that's really about the whole app, not sidebar navigation --
// moved to this persistent top bar instead, alongside the account menu.
const paletteOpen = ref(false)
const mobileSidebarOpen = ref(false)
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = true
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))

// Single-key shortcuts that work on every staff screen (useShortcuts); "?"
// lists them all. "/" opens the same search as ⌘K.
const shortcutsOpen = ref(false)
useShortcuts({
  '?': () => (shortcutsOpen.value = true),
  '/': () => (paletteOpen.value = true),
})
useGoShortcuts(() => ({ d: '/dashboard', m: '/practitioner', c: '/calendar', p: '/patients', i: '/inbox', b: '/billing', r: '/reports' }))

// Team messages and alerts: one subscription for the whole staff app, so an
// alert reaches whatever screen a colleague is on (composables/useTeamChat).
const teamChat = useTeamChat()
onMounted(() => {
  watch(
    () => store.accountId,
    (id) => {
      if (id) teamChat.start()
    },
    { immediate: true },
  )
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function dismissDenied() {
  showDenied.value = false
  const query = { ...route.query }
  delete query.denied
  router.replace({ query })
}

// A release published since this tab loaded (plugins/stale-build-reload.client.ts).
// The next navigation reloads anyway; this is for someone who stays put.
const { available: newVersion } = useNewVersion()
// fullPath: reloadNuxtApp() on its own reloads location.pathname, dropping
// the query -- the calendar's date and view, a patient's open tab.
function reloadForNewVersion() {
  reloadNuxtApp({ path: route.fullPath, force: true })
}

// A Supabase read that failed (plugins/supabase-failures.client.ts) would
// otherwise show as an empty list and nothing else. One toast per page, not
// one per query: a page whose data is gone fails several reads at once, and
// one notice says all of it. Only the staff app says so -- the booking page,
// the portal and the shared documents use other layouts.
const { failure: supabaseFailure, refusedWrites } = useSupabaseFailureNotice()
const { showToast, lastErrorToastAt } = useToast()
let dataNoticeShown = false
// Waits a moment and speaks only if the screen has not: the ones that check
// their writes say why in a toast of their own.
function sayNotSaved() {
  const failedAt = Date.now()
  setTimeout(() => {
    if (lastErrorToastAt() >= failedAt) return
    showToast(t('That change could not be saved. Check it and try again.', 'Ese cambio no se ha podido guardar. Revísalo y vuelve a intentarlo.'), 'error', 8000)
  }, 600)
}
// The same for a write the database refused on purpose (a permission, a
// guard): not a failure, but silence leaves the screen looking as if it took.
// Only when it follows something the person just did on this page: a
// best-effort write a screen makes for itself (marking a thread read, say)
// can be refused for a restricted role, and that is nobody's lost work.
let lastActedAt = 0
function noteAction(e: Event) {
  if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Enter') return
  lastActedAt = Date.now()
}
onMounted(() => {
  window.addEventListener('pointerup', noteAction, { capture: true, passive: true })
  window.addEventListener('keydown', noteAction, { capture: true, passive: true })
})
onUnmounted(() => {
  window.removeEventListener('pointerup', noteAction, { capture: true })
  window.removeEventListener('keydown', noteAction, { capture: true })
})
onUnmounted(router.afterEach(() => (lastActedAt = 0)))
watch(refusedWrites, () => {
  // A read-only account's refusals are answered by the dialog below.
  if (store.isReadOnly) return
  if (Date.now() - lastActedAt < 2000) sayNotSaved()
})

// The end of the trial, where it gets in the way. An account that is
// read-only (an ended trial past its grace week, or a cancelled plan) still
// opens every screen; what it cannot do is change anything, and the moment it
// tries is the moment to ask for a card (plugins/read-only.client.ts). Only
// after something the person did, like the toast above: a write a screen
// makes for itself on load is nobody's lost work.
const { refusedAt } = useReadOnlyPrompt()
const addCardDialog = ref<'grace' | 'read_only' | 'refused' | null>(null)
watch(refusedAt, (at) => {
  if (at && at - lastActedAt < 3000) addCardDialog.value = 'refused'
})

// And once a day to the owner, from the day the trial ends: the bar above
// every screen is easy to stop seeing. Remembered per account in this browser;
// never on Subscription, which is where the dialog would send them.
const DAILY_PROMPT_KEY = 'quiroflow-trial-ended-prompt'
function maybeDailyPrompt() {
  if (!store.loaded || !store.isOwner || !store.accountId) return
  if (!store.trialEnded && !store.isReadOnly) return
  if (currentPath.value === '/subscription' || addCardDialog.value) return
  const today = new Date().toISOString().slice(0, 10)
  const key = `${DAILY_PROMPT_KEY}:${store.accountId}`
  try {
    if (localStorage.getItem(key) === today) return
    localStorage.setItem(key, today)
  } catch {
    // Storage refused (a private window): ask anyway, once per load.
  }
  addCardDialog.value = store.trialEnded ? 'grace' : 'read_only'
}
onMounted(() => {
  watch(() => [store.loaded, store.trialEnded, store.isReadOnly, currentPath.value], maybeDailyPrompt, { immediate: true })
})
onUnmounted(router.afterEach(() => (dataNoticeShown = false)))
watch(supabaseFailure, (f) => {
  if (!f) return
  if (!f.read) {
    // A WRITE that failed. Some ninety call sites await an insert, update or
    // delete and never look at the result, so a payment or a note that was
    // not saved left the screen exactly as it was, with nothing said. The
    // screens that do check say why themselves, usually in a toast.
    sayNotSaved()
    return
  }
  if (dataNoticeShown) return
  dataNoticeShown = true
  showToast(t('Some data could not be loaded. Reload the page to try again.', 'Algunos datos no se han podido cargar. Recarga la página para volver a intentarlo.'), 'error', 8000)
})
</script>

<template>
  <!-- No lock screen. An account that has not paid (an ended trial past its
  grace week, or a cancelled plan) is READ-ONLY: every screen still opens, and
  what is refused is changing anything (20261120184541_trial_grace_then_read_only).
  BillingBanner says so above every screen, and SubscriptionAddCardDialog asks
  for a card when a change is refused. -->
  <!-- 100dvh where the browser has it: 100vh on iPhone Safari is the height
  with its toolbars hidden, so the bottom of every page -- the Inbox composer,
  a list's last row -- sat behind the toolbar. Behind @supports rather than
  `h-screen h-dvh`, because the production CSS emits .h-dvh BEFORE .h-screen
  and 100vh would win. relative + overflow-hidden contain any
  absolutely positioned element with no positioned ancestor (an sr-only label
  in a wide table cell, say): left alone those resolve against the page
  itself and let an iPhone pan the whole app sideways. -->
  <div class="relative flex h-screen supports-[height:100dvh]:h-dvh flex-col overflow-hidden bg-surface-page">
    <!-- First thing a keyboard reaches: otherwise eighteen sidebar links and
    the top bar come before the page, on every page. Hidden until focused. -->
    <a
      href="#main-content"
      data-cy="skip-to-content"
      class="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-surface focus:px-3 focus:py-2 focus:text-[13.5px] focus:font-semibold focus:border focus:border-brand focus:text-ink-900 focus:shadow-focus"
    >
      {{ t('Skip to content', 'Saltar al contenido') }}
    </a>
    <BillingBanner />
    <div class="flex flex-1 overflow-hidden">
      <AppSidebar :open="mobileSidebarOpen" @close="mobileSidebarOpen = false" />
      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- Persistent across every page (unlike each page's own PageHeader,
        which not every page even has) so the account menu has one home
        instead of living in the sidebar, where it permanently cost a row of
        vertical space on every screen. -->
        <div class="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-4 touch:h-12">
          <div class="flex min-w-0 items-center gap-2">
            <!-- The sidebar is an off-canvas drawer below lg (AppSidebar.vue),
            so this is the only way to reach it on a phone or narrow tablet. -->
            <button
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl border border-line-control bg-chip-bg text-ink-muted hover:bg-surface-subtle touch:h-11 touch:w-11 lg:hidden"
              data-cy="open-sidebar"
              :aria-label="t('Open menu', 'Abrir menú')"
              @click="mobileSidebarOpen = true"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.5 3.5h11M1.5 7h11M1.5 10.5h11" /></svg>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl border border-line-control bg-chip-bg text-left text-[13px] text-ink-muted hover:bg-surface-subtle touch:h-11 touch:min-w-11 lg:w-64 lg:justify-start lg:gap-2 lg:px-2.5"
              :title="t('Search or jump to (⌘K)', 'Buscar o ir a (⌘K)')"
              @click="paletteOpen = true"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" class="shrink-0"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
              <span class="hidden flex-1 lg:inline">{{ t('Search or jump to', 'Buscar o ir a') }}</span>
              <span class="hidden rounded border border-line-control bg-surface px-1 py-px font-mono text-[11px] text-ink-faint2 lg:inline">⌘K</span>
            </button>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <TeamAlertButton />
            <!-- Where the help assistant (SupportHelpWidget) was until
            27 Nov 2026: in production it had been asked three questions in
            all, and no clinic had ever escalated one to a person. -->
            <!-- Owners only, as /novedades is (utils/routePermissions.ts). -->
            <NewsTopBarButton v-if="store.isOwner" />
            <AppThemeToggle />
            <AppAccountMenu />
          </div>
        </div>
        <TeamAlertBanner />
        <div
          v-if="newVersion"
          data-cy="new-version-banner"
          class="flex items-center justify-between gap-3 border-b border-info-border bg-info-bg px-6 py-2 text-sm text-info-text"
        >
          <span>{{ t('A new version of QuiroFlow is available. It loads when you change screen.', 'Hay una versión nueva de QuiroFlow. Se cargará al cambiar de pantalla.') }}</span>
          <button type="button" class="shrink-0 font-medium underline" @click="reloadForNewVersion">{{ t('Reload now', 'Recargar ahora') }}</button>
        </div>
        <div v-if="showDenied" class="flex items-center justify-between bg-warning-bg px-6 py-2 text-sm text-warning-text">
          <span>{{ t("You don't have access to that section.", 'No tienes acceso a esa sección.') }}</span>
          <button type="button" class="font-medium underline" @click="dismissDenied">{{ t('Dismiss', 'Cerrar') }}</button>
        </div>
        <main id="main-content" tabindex="-1" class="flex flex-1 flex-col overflow-hidden outline-none">
          <slot />
        </main>
      </div>
    </div>
    <AppCommandPalette v-if="paletteOpen" @close="paletteOpen = false" @shortcuts="(paletteOpen = false), (shortcutsOpen = true)" />
    <ShortcutsDialog v-if="shortcutsOpen" @close="shortcutsOpen = false" />
    <SubscriptionAddCardDialog v-if="addCardDialog" :mode="addCardDialog" @close="addCardDialog = null" />
  </div>
</template>
