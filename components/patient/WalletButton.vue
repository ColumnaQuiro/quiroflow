<script setup lang="ts">
// "Añadir a Apple Wallet" or "Añadir a Google Wallet" for one bono, in the
// patient's app and the portal -- whichever this device has, once that
// Wallet is configured on the server. Shared with mobile/.
//
// Apple: an iPhone, iPad, a Mac's Safari, or the iOS app. The link it opens
// is signed for ten minutes (api/wallet/bono/<id>/link): Safari has no
// session, and it is Safari that hands the pass to Wallet -- in the app,
// going to an outside address opens it there.
//
// Google: everything else. The server sends the pass to Google first and
// answers with Google's own save page (the same link route), which
// Android hands to the Wallet app; on a computer it saves to the Google
// account, and the phone picks it up from there.
// Google's own button, as its brand guidelines require: their artwork,
// unaltered, in the app's language (developers.google.com/wallet/generic/
// resources/brand-guidelines). Imported relatively so the mobile app's build
// bundles it too; it has no access to the web's public/.
import googleWalletEs from '../../assets/wallet/add-to-google-wallet-es.svg?url'
import googleWalletEn from '../../assets/wallet/add-to-google-wallet-en.svg?url'

const props = defineProps<{ purchaseId: string }>()

const t = useT()
const authedFetch = useAuthedFetch()

const kind = ref<'apple' | 'google' | null>(null)
onMounted(async () => {
  const ua = navigator.userAgent
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Firefox|Edg/.test(ua))
  try {
    const status = await authedFetch<{ apple: boolean; google?: boolean }>('/api/wallet/status')
    kind.value = apple ? (status.apple ? 'apple' : null) : status.google ? 'google' : null
  } catch {
    kind.value = null
  }
})

const busy = ref(false)
const error = ref('')
async function add() {
  busy.value = true
  error.value = ''
  try {
    const { url } = await authedFetch<{ url: string }>(`/api/wallet/bono/${props.purchaseId}/link`, { method: 'POST', body: { wallet: kind.value } })
    window.location.href = url
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't prepare it.", 'No se ha podido preparar.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="kind" class="mt-2.5">
    <button v-if="kind === 'apple'" type="button" class="inline-flex h-10 items-center gap-2 rounded-ctl bg-black px-3.5 text-[13.5px] font-semibold text-white disabled:opacity-60" :disabled="busy" data-cy="wallet-add-apple" @click="add">
      <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M1 6h18" stroke="currentColor" stroke-width="1.6" /></svg>
      {{ busy ? t('Preparing…', 'Preparando…') : t('Add to Apple Wallet', 'Añadir a Apple Wallet') }}
    </button>
    <!-- At least 48 px high, with 8 px clear around it (the card gives the rest), per the guidelines. -->
    <button v-else type="button" class="block rounded-pill disabled:opacity-60" :disabled="busy" :aria-busy="busy" data-cy="wallet-add-google" @click="add">
      <img :src="t(googleWalletEn, googleWalletEs)" :alt="t('Add to Google Wallet', 'Añadir a Google Wallet')" class="block h-12 w-auto" />
    </button>
    <p v-if="error" role="alert" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
