<script setup lang="ts">
import type { NuxtError } from '#app'

// What a bad address or a failed page shows. Without this file Nuxt rendered
// its own page: a bare "404", in English whatever the interface language, with
// nothing of the app around it and no way back but the address bar.
const props = defineProps<{ error: NuxtError }>()
const t = useT()
const { preference } = useLang()

const notFound = computed(() => props.error.statusCode === 404)
// A patient's link (a booking page, the portal, a waitlist or photo link) is
// not a way into QuiroFlow, and "Go to QuiroFlow" would land them on the staff
// sign-in. They get no button: the clinic that sent the link can send another.
const PATIENT_PATHS = ['/book', '/portal', '/regalo', '/valorar', '/aprende', '/check-in', '/waitlist/', '/photo-upload', '/unsubscribe', '/payment-done', '/card-saved', '/doc']
const route = useRoute()
const forPatient = computed(() => {
  // A server-rendered error carries the address it failed on; one raised on
  // the client does not, and the route is that address then.
  const url = (props.error as NuxtError & { url?: string }).url
  const path = url ? new URL(url, 'http://x').pathname : route.path
  return PATIENT_PATHS.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)))
})

const title = computed(() => (notFound.value ? t("This page doesn't exist", 'Esta página no existe') : t('Something went wrong', 'Algo ha fallado')))
const body = computed(() => {
  if (forPatient.value) {
    return notFound.value
      ? t('The link may be old or mistyped. If your clinic sent it, ask them for a new one.', 'Puede que el enlace sea antiguo o tenga un error. Si te lo envió tu clínica, pídeles uno nuevo.')
      : t('Try again in a moment. If it keeps happening, contact your clinic.', 'Vuelve a intentarlo en un momento. Si sigue pasando, contacta con tu clínica.')
  }
  return notFound.value
    ? t('The link may be old or mistyped, or the page has moved.', 'Puede que el enlace sea antiguo, tenga un error o la página se haya movido.')
    : t('This page could not load. Try again; if it keeps happening, tell us from Help.', 'Esta página no ha podido cargar. Vuelve a intentarlo; si sigue pasando, avísanos desde Ayuda.')
})

useHead({
  htmlAttrs: { lang: () => preference.value },
  title: () => `${title.value} · QuiroFlow`,
})

function goHome() {
  clearError({ redirect: '/' })
}
function tryAgain() {
  reloadNuxtApp({ force: true })
}
</script>

<template>
  <main class="flex min-h-screen supports-[height:100dvh]:min-h-dvh items-center justify-center bg-surface-page px-4 py-10" data-cy="error-page" :data-status="error.statusCode">
    <div class="w-full max-w-[400px]">
      <div v-if="!forPatient" class="mb-6 flex items-center gap-[9px]">
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-[26px] w-[26px]" />
        <span class="text-[16px] font-semibold tracking-tightTitle text-ink-900">QuiroFlow</span>
      </div>
      <p class="font-mono text-[12px] font-semibold uppercase tracking-[.08em] text-ink-muted">Error {{ error.statusCode }}</p>
      <h1 class="mt-2 text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">{{ body }}</p>
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <button
          v-if="!notFound"
          type="button"
          data-cy="error-try-again"
          class="flex h-10 touch:h-11 items-center rounded-ctl bg-brand px-4 text-[14px] font-semibold text-brand-on hover:bg-brand-hover focus-visible:shadow-focus"
          @click="tryAgain"
        >
          {{ t('Try again', 'Reintentar') }}
        </button>
        <button
          v-if="!forPatient"
          type="button"
          data-cy="error-home"
          :class="notFound ? 'bg-brand text-brand-on hover:bg-brand-hover' : 'border border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'"
          class="flex h-10 touch:h-11 items-center rounded-ctl px-4 text-[14px] font-semibold focus-visible:shadow-focus"
          @click="goHome"
        >
          {{ t('Go to QuiroFlow', 'Ir a QuiroFlow') }}
        </button>
      </div>
    </div>
  </main>
</template>
