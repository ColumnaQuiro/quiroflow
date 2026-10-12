<script setup lang="ts">
import QRCode from 'qrcode'

// A one-page A4 sign for the front desk: scan to say you have arrived. The QR
// opens /portal/check-in on the clinic's own address, which signs the patient
// in if needed and shows today's visit with "Ya estoy aquí" (the app's home
// has the same button). Opened from Settings > Mobile App, beside the app's
// own desk sign, and printed straight away.
definePageMeta({ layout: false })

const store = useAccountStore()
const t = useT()
useHead({ title: t('Check-in sign', 'Cartel de llegada') })

const url = `${useRequestURL().origin}/portal/check-in`
const qr = ref('')
onMounted(async () => {
  qr.value = await QRCode.toDataURL(url, { width: 700, margin: 1 })
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
    <main class="mx-auto flex max-w-[190mm] flex-col items-center gap-8 px-4 pb-10 text-center print:px-0 print:pb-0" data-cy="check-in-sign">
      <header class="flex flex-col gap-2">
        <p class="text-[18px] font-semibold text-[#4F46E5]">{{ store.accountName }}</p>
        <h1 class="text-[44px] font-bold leading-tight tracking-tightTitle">{{ t("Just arrived?", '¿Acabas de llegar?') }}</h1>
        <p class="text-[20px] text-[#3A3F52]">{{ t('Scan the code and tap "I\'m here". Take a seat, we\'ll call you.', 'Escanea el código y toca «Ya estoy aquí». Toma asiento, te llamamos.') }}</p>
      </header>
      <img v-if="qr" :src="qr" :alt="t('QR code to check in', 'Código QR para registrar tu llegada')" class="h-[95mm] w-[95mm]" data-cy="check-in-sign-qr" :data-url="url" />
      <p class="text-[16px] text-[#3A3F52]">{{ t('With the QuiroFlow app, the button is also on your home screen.', 'Con la app de QuiroFlow, el botón también está en tu pantalla de inicio.') }}</p>
    </main>
  </div>
</template>

<style>
@page {
  size: A4;
  margin: 14mm;
}
</style>
