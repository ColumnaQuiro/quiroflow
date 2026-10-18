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
// Each Wallet's own badge, as both sets of brand guidelines require: their
// artwork, unaltered, in the app's language -- Apple's from
// developer.apple.com/wallet/add-to-apple-wallet-guidelines (under its Wallet
// Marketing Agreement), Google's from developers.google.com/wallet/generic/
// resources/brand-guidelines. Imported relatively so the mobile app's build
// bundles them too; it has no access to the web's public/.
import appleWalletEs from '../../assets/wallet/add-to-apple-wallet-es.svg?url'
import appleWalletEn from '../../assets/wallet/add-to-apple-wallet-en.svg?url'
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
    <!-- Shown at 48 px high, Google's minimum, with the card's padding as the clear space both ask for. -->
    <button type="button" class="block rounded-ctl disabled:opacity-60" :disabled="busy" :aria-busy="busy" :data-cy="`wallet-add-${kind}`" @click="add">
      <img v-if="kind === 'apple'" :src="t(appleWalletEn, appleWalletEs)" :alt="t('Add to Apple Wallet', 'Añadir a Apple Wallet')" class="block h-12 w-auto" />
      <img v-else :src="t(googleWalletEn, googleWalletEs)" :alt="t('Add to Google Wallet', 'Añadir a Google Wallet')" class="block h-12 w-auto" />
    </button>
    <p v-if="error" role="alert" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
