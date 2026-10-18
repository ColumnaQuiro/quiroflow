<script setup lang="ts">
// "Añadir a Apple Wallet" for one bono, in the patient's app and the portal.
// Shown only where Wallet exists (an iPhone, iPad or a Mac's Safari, or the
// iOS app) and once the pass certificate is configured. The link it opens
// is signed for ten minutes (api/wallet/bono/<id>/link): Safari has no
// session, and it is Safari that hands the pass to Wallet -- in the app,
// going to an outside address opens it there. Shared with mobile/.
const props = defineProps<{ purchaseId: string }>()

const t = useT()
const authedFetch = useAuthedFetch()

const supported = ref(false)
onMounted(async () => {
  const ua = navigator.userAgent
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Firefox|Edg/.test(ua))
  if (!apple) return
  try {
    supported.value = (await authedFetch<{ apple: boolean }>('/api/wallet/status')).apple
  } catch {
    supported.value = false
  }
})

const busy = ref(false)
const error = ref('')
async function add() {
  busy.value = true
  error.value = ''
  try {
    const { url } = await authedFetch<{ url: string }>(`/api/wallet/bono/${props.purchaseId}/link`, { method: 'POST' })
    window.location.href = url
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't prepare it.", 'No se ha podido preparar.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="supported" class="mt-2.5">
    <button type="button" class="inline-flex h-10 items-center gap-2 rounded-ctl bg-black px-3.5 text-[13.5px] font-semibold text-white disabled:opacity-60" :disabled="busy" data-cy="wallet-add" @click="add">
      <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M1 6h18" stroke="currentColor" stroke-width="1.6" /></svg>
      {{ busy ? t('Preparing…', 'Preparando…') : t('Add to Apple Wallet', 'Añadir a Apple Wallet') }}
    </button>
    <p v-if="error" role="alert" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
