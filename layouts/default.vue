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
// The lock screen renders no page at all, so on "Choose a plan" the address
// changed to /subscription, the page never rendered, the route never moved,
// and the lock screen stayed -- a locked owner could not reach the one page
// that lets them pay.
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
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function dismissDenied() {
  showDenied.value = false
  const query = { ...route.query }
  delete query.denied
  router.replace({ query })
}

const contactHref = 'mailto:hola@quiroflow.com'
</script>

<template>
  <!-- Only the staff app (this layout) locks -- public booking, the patient
  portal, and shared docs use their own layouts and keep working regardless,
  so a clinic's unpaid bill never blocks their own patients. -->
  <!-- /subscription is exempt so the escape hatch below has somewhere to go.
  It used to open Stripe's hosted portal directly, which is a dead end for the
  case that matters most: a trial that expired without ever subscribing has no
  Stripe customer, so portal-session.post.ts 400s and useBillingPortal quietly
  redirects to a mailto -- an account that wants to pay us could not. The
  subscription page carries both routes out (Checkout for a first
  subscription, the portal for a lapsed one), and every API it calls is gated
  on requireTeamMember rather than requireActiveAccount, so all of them keep
  working while the account is locked. -->
  <div v-if="store.isBillingLocked && currentPath !== '/subscription'" class="flex h-screen items-center justify-center bg-surface-page px-6">
    <div class="max-w-sm text-center">
      <h1 class="text-lg font-semibold text-gray-900">Account locked</h1>
      <p class="mt-2 text-sm text-gray-600">This QuiroFlow account is locked pending payment.</p>
      <NuxtLink
        v-if="store.isOwner"
        to="/subscription"
        class="mt-4 block w-full rounded-ctl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Choose a plan
      </NuxtLink>
      <p v-else class="mt-4 text-sm text-gray-600">Ask the account owner to renew the subscription.</p>
      <p class="mt-3 text-sm text-gray-600">Or contact us directly:</p>
      <a :href="contactHref" class="mt-1 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">hola@quiroflow.com</a>
    </div>
  </div>
  <div v-else class="flex h-screen flex-col bg-surface-page">
    <BillingBanner />
    <div class="flex flex-1 overflow-hidden">
      <AppSidebar :open="mobileSidebarOpen" @close="mobileSidebarOpen = false" />
      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- Persistent across every page (unlike each page's own PageHeader,
        which not every page even has) so the account menu has one home
        instead of living in the sidebar, where it permanently cost a row of
        vertical space on every screen. -->
        <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-4 touch:h-12">
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
              <span class="hidden rounded border border-line-control bg-surface px-1 py-px font-mono text-[10.5px] text-ink-faint2 lg:inline">⌘K</span>
            </button>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <AppThemeToggle />
            <AppAccountMenu />
          </div>
        </div>
        <div v-if="showDenied" class="flex items-center justify-between bg-amber-50 px-6 py-2 text-sm text-amber-800">
          <span>You don't have access to that section.</span>
          <button type="button" class="font-medium underline" @click="dismissDenied">Dismiss</button>
        </div>
        <main class="flex flex-1 flex-col overflow-hidden">
          <slot />
        </main>
      </div>
    </div>
    <AppCommandPalette v-if="paletteOpen" @close="paletteOpen = false" />
    <SupportHelpWidget />
  </div>
</template>
