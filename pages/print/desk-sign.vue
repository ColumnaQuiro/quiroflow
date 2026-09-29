<script setup lang="ts">
import QRCode from 'qrcode'
import { appStoreUrl, playStoreUrl } from '~/utils/appLinks'

// A one-page A4 sign for the front desk: how to install the app, and the
// clinic's join code to scan once it is installed. Opened from Settings >
// Mobile App in its own tab, without the app's layout, and printed straight
// away.
//
// Two kinds of QR on purpose. The store codes are for the phone's camera,
// before the app exists; the join code is for the app's own "Join your
// clinic" scanner, and a camera pointed at it only gets the bare code.

definePageMeta({ layout: false })

const store = useAccountStore()
const t = useT()

useHead({ title: t('Desk sign', 'Cartel') })

const iosUrl = appStoreUrl()
const androidUrl = playStoreUrl()

const joinQr = ref('')
const iosQr = ref('')
const androidQr = ref('')

onMounted(async () => {
  const [join, ios, android] = await Promise.all([
    store.accountSlug ? QRCode.toDataURL(store.accountSlug, { width: 600, margin: 1 }) : Promise.resolve(''),
    iosUrl ? QRCode.toDataURL(iosUrl, { width: 300, margin: 1 }) : Promise.resolve(''),
    androidUrl ? QRCode.toDataURL(androidUrl, { width: 300, margin: 1 }) : Promise.resolve(''),
  ])
  joinQr.value = join
  iosQr.value = ios
  androidQr.value = android
  // Let the images paint before the print dialog snapshots the page.
  await nextTick()
  requestAnimationFrame(printSign)
})

function printSign() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-white text-[#15171E] print:min-h-0">
    <div class="mx-auto flex max-w-[190mm] items-center justify-end gap-2 px-4 py-4 print:hidden">
      <UiBtn variant="primary" @click="printSign">{{ t('Print', 'Imprimir') }}</UiBtn>
    </div>

    <main class="mx-auto flex max-w-[190mm] flex-col gap-10 px-4 pb-10 print:px-0 print:pb-0" data-cy="desk-sign">
      <header class="flex flex-col gap-2 text-center">
        <p class="text-[18px] font-semibold text-[#4F46E5]">{{ store.accountName }}</p>
        <h1 class="text-[40px] font-bold leading-tight tracking-tightTitle">{{ t('Get our app', 'Descarga nuestra app') }}</h1>
        <p class="text-[18px] text-[#3A3F52]">{{ t('Your appointments and your clinic, on your phone.', 'Tus citas y tu clínica, en el móvil.') }}</p>
      </header>

      <section class="flex flex-col gap-4">
        <h2 class="text-[22px] font-bold"><span class="text-[#4F46E5]">1.</span> {{ t('Install QuiroFlow', 'Instala QuiroFlow') }}</h2>
        <div class="flex justify-center gap-12">
          <figure v-if="iosUrl" class="flex flex-col items-center gap-2">
            <img v-if="iosQr" :src="iosQr" alt="" class="h-[36mm] w-[36mm]" />
            <figcaption class="text-[16px] font-semibold">App Store</figcaption>
          </figure>
          <figure v-if="androidUrl" class="flex flex-col items-center gap-2">
            <img v-if="androidQr" :src="androidQr" alt="" class="h-[36mm] w-[36mm]" />
            <figcaption class="text-[16px] font-semibold">Google Play</figcaption>
          </figure>
        </div>
        <p class="text-center text-[15px] text-[#3A3F52]">{{ t('Point your phone\'s camera at the code for your phone.', 'Apunta la cámara del móvil al código de tu tienda.') }}</p>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="text-[22px] font-bold"><span class="text-[#4F46E5]">2.</span> {{ t('Tap "Join your clinic" and scan this code', 'Toca "Unirse a tu clínica" y escanea este código') }}</h2>
        <div class="flex flex-col items-center gap-3">
          <img v-if="joinQr" :src="joinQr" :alt="t('QR code with the clinic code', 'Código QR con el código de la clínica')" class="h-[70mm] w-[70mm]" />
          <p class="text-[15px] text-[#3A3F52]">{{ t('Or type the code:', 'O escribe el código:') }}</p>
          <p class="rounded-[10px] border-2 border-[#15171E] px-6 py-2 font-mono text-[30px] font-medium tracking-[.06em]">{{ store.accountSlug }}</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
@page {
  size: A4;
  margin: 14mm;
}
</style>
