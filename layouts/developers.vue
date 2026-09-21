<script setup lang="ts">
import { DEV_PORTAL_ORIGIN } from '~/utils/devPortal'

// Chrome for the public developer portal. Deliberately not the app's default
// layout: there's no sidebar of clinic navigation, no account menu and no
// session, because most people reading this have never signed in.
const route = useRoute()
const { link, sections, onDevHost } = useDevPortal()

const mobileNavOpen = ref(false)
watch(() => route.path, () => (mobileNavOpen.value = false))

// Both URL shapes resolve the same page (see utils/devPortal.ts), so the
// highlight has to recognise both -- otherwise nothing looks selected when a
// page is reached at the shape the current host doesn't generate links for.
function isActive(slug: string) {
  return route.path === `/${slug}` || route.path === `/developers/${slug}`
}

// Where "Get a token" sends people. The portal is public, so this is the one
// link that reaches back into the app, and on the docs subdomain it has to be
// absolute to get there at all.
const tokenSettingsUrl = 'https://app.quiroflow.com/settings/developers'
</script>

<template>
  <div class="min-h-screen bg-surface-page text-ink-700">
    <header class="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-4 px-5">
        <NuxtLink :to="link('introduction')" class="flex items-center gap-2.5">
          <img src="/logo/quiroflow-mark.svg" alt="" class="h-5 w-5" />
          <span class="text-[15px] font-semibold tracking-tightTitle text-ink-900">QuiroFlow</span>
          <span class="hidden rounded-pill bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-text sm:inline">API</span>
        </NuxtLink>

        <div class="flex items-center gap-3">
          <a :href="tokenSettingsUrl" class="hidden text-[13px] font-medium text-ink-muted2 hover:text-ink-700 sm:inline">Get a token</a>
          <a
            :href="tokenSettingsUrl"
            class="inline-flex h-8 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover"
          >
            Sign in
          </a>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-ctl border border-line-control text-ink-muted2 lg:hidden"
            :aria-expanded="mobileNavOpen"
            aria-label="Toggle documentation navigation"
            @click="mobileNavOpen = !mobileNavOpen"
          >
            <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M3 6h14M3 10h14M3 14h14" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <div class="mx-auto flex max-w-[1180px] gap-10 px-5">
      <nav
        class="shrink-0 lg:w-[212px] lg:py-8"
        :class="mobileNavOpen ? 'fixed inset-x-0 top-14 z-20 max-h-[70vh] overflow-y-auto border-b border-line bg-surface p-5 shadow-popover lg:static lg:max-h-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' : 'hidden lg:block'"
      >
        <div class="space-y-6 lg:sticky lg:top-[72px]">
          <div v-for="section in sections" :key="section.en">
            <p class="px-2 text-[10.5px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ section.en }}</p>
            <div class="mt-1 space-y-0.5">
              <NuxtLink
                v-for="page in section.pages"
                :key="page.slug"
                :to="link(page.slug)"
                class="block rounded-ctlSm px-2 py-1.5 text-[13px] leading-tight"
                :class="isActive(page.slug) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-muted2 hover:bg-surface-subtle'"
              >
                {{ page.en }}
              </NuxtLink>
            </div>
          </div>

          <div class="border-t border-line-divider pt-4">
            <a
              href="/api/public/v1/openapi.json"
              class="block rounded-ctlSm px-2 py-1.5 text-[13px] text-ink-muted2 hover:bg-surface-subtle"
            >
              OpenAPI spec ↓
            </a>
          </div>
        </div>
      </nav>

      <main class="min-w-0 flex-1 py-8 pb-24">
        <slot />
      </main>
    </div>

    <footer class="border-t border-line bg-surface">
      <div class="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-ink-faint">
        <p>© {{ new Date().getFullYear() }} QuiroFlow</p>
        <div class="flex flex-wrap items-center gap-4">
          <a href="mailto:hola@quiroflow.com" class="hover:text-ink-600">hola@quiroflow.com</a>
          <a href="https://app.quiroflow.com/legal/terms" class="hover:text-ink-600">Terms</a>
          <a href="https://app.quiroflow.com/legal/privacy" class="hover:text-ink-600">Privacy</a>
          <!-- Only shown on the app-host copies: on the docs subdomain the
               reader is already on the canonical site. -->
          <a v-if="!onDevHost" :href="DEV_PORTAL_ORIGIN" class="hover:text-ink-600">developers.quiroflow.com</a>
        </div>
      </div>
    </footer>
  </div>
</template>
