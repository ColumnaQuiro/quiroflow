<script setup lang="ts">
// The patient's QR code for the front-desk check-in tablet (pages/check-in),
// beside "Ya estoy aquí" in the app and the portal: shown to the tablet's
// camera or its scanner, it checks them in as their date of birth would.
// Drawn by the server (/api/portal/appointments/check-in-code), so neither the
// app nor the portal carries a QR library; nothing shows at all when the
// visit's location has no tablet.
const props = defineProps<{ appointmentId: string }>()

const t = useT()
const authedFetch = useAuthedFetch()
const open = ref(false)
const svg = ref<string | null>(null)

onMounted(async () => {
  try {
    svg.value = (await authedFetch<{ svg: string | null }>(`/api/portal/appointments/check-in-code?appointmentId=${encodeURIComponent(props.appointmentId)}`)).svg
  } catch {
    // No code: the button "Ya estoy aquí" above still works, and so does the
    // date of birth on the tablet.
  }
})
const src = computed(() => (svg.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.value)}` : ''))
</script>

<template>
  <div v-if="src">
    <button type="button" class="flex min-h-11 w-full items-center justify-center gap-2 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-medium text-ink-700" :aria-expanded="open" data-cy="patient-check-in-code-toggle" @click="open = !open">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4" /></svg>
      {{ open ? t('Hide code', 'Ocultar código') : t('Show my code for the tablet', 'Mostrar mi código para la tablet') }}
    </button>
    <!-- White in dark mode too: a scanner needs dark modules on a light ground. -->
    <div v-if="open" class="mt-3 flex flex-col items-center gap-2 rounded-ctl border border-line bg-white p-4" data-cy="patient-check-in-code">
      <img :src="src" alt="" class="h-56 w-56" data-cy="patient-check-in-code-qr" />
      <p class="text-center text-[12.5px] text-[#4B5563]">{{ t('Show this code to the check-in tablet at reception.', 'Enseña este código a la tablet de llegada de recepción.') }}</p>
    </div>
  </div>
</template>
