<script setup lang="ts">
// No login -- the phone that opens this link (from a WhatsApp/email offer)
// has no session, and doesn't need one; the token itself (validated
// server-side) gates it. Same layout: false pattern as the public booking
// page and photo-upload/[token].vue.
definePageMeta({ layout: false })

const route = useRoute()
const token = route.params.token as string

interface OfferInfo {
  clinicName: string
  appointmentTypeName: string | null
  practitionerName: string | null
  startsAt: string
  endsAt: string
}

const phase = ref<'loading' | 'invalid' | 'ready' | 'claiming' | 'done'>('loading')
const offer = ref<OfferInfo | null>(null)
const error = ref('')

// The API answers in English; this page is the patient's, and Spanish. Its
// known refusals are said here in Spanish, and anything else falls back to
// the page's own sentence rather than showing a raw English one.
const REFUSALS: Record<string, string> = {
  'This link is invalid.': 'Este enlace no es válido.',
  'This appointment has already been claimed.': 'Esta cita ya se ha reservado.',
  'This offer is no longer available.': 'Esta oferta ya no está disponible.',
  'This offer has expired.': 'Esta oferta ha caducado.',
  'This offer was just claimed by someone else.': 'Otra persona acaba de reservar esta cita.',
  'This slot was just taken. Please contact the clinic.': 'Este hueco se acaba de ocupar. Ponte en contacto con la clínica.',
}
function refusal(e: any, fallback: string) {
  const message = e?.data?.statusMessage
  return (message && REFUSALS[message]) || fallback
}

const slotLabel = computed(() => {
  if (!offer.value) return ''
  return new Date(offer.value.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
})

onMounted(async () => {
  try {
    offer.value = await $fetch<OfferInfo>(`/api/waitlist/${token}`)
    phase.value = 'ready'
  } catch (e: any) {
    error.value = refusal(e, 'Este enlace no es válido o ha caducado.')
    phase.value = 'invalid'
  }
})

async function claim() {
  phase.value = 'claiming'
  error.value = ''
  try {
    await $fetch(`/api/waitlist/${token}`, { method: 'POST' })
    phase.value = 'done'
  } catch (e: any) {
    error.value = refusal(e, 'No se ha podido reservar esta cita.')
    phase.value = 'ready'
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-card">
      <!-- The shape of the offer while it loads, so the card does not jump
           from one line of text to the full offer. -->
      <div v-if="phase === 'loading'" class="flex flex-col items-center" aria-busy="true" aria-live="polite">
        <span class="sr-only">Cargando…</span>
        <UiSkeleton class="h-5 w-48 rounded-ctlSm" />
        <UiSkeleton class="mt-2 h-3.5 w-28 rounded-ctlSm" />
        <UiSkeleton class="mt-4 h-[62px] w-full rounded-ctl" />
        <UiSkeleton class="mt-5 h-11 w-full rounded-ctl" />
      </div>

      <!-- An expired or unknown link is the common case, not an error the
           patient caused: said plainly, in ink, not in alarm red. -->
      <div v-else-if="phase === 'invalid'" data-cy="waitlist-claim-invalid" class="flex flex-col items-center" role="alert">
        <div class="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface-subtle text-ink-muted">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <p class="mt-4 text-[15px] font-semibold leading-snug text-ink-900">{{ error }}</p>
      </div>

      <template v-else-if="phase === 'ready' || phase === 'claiming'">
        <h1 data-cy="waitlist-claim-offer" class="text-lg font-semibold tracking-tightTitle text-ink-900">¡Se ha liberado una cita!</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ offer?.clinicName }}</p>

        <div class="mt-4 rounded-ctl border border-line-control bg-surface-subtle p-3 text-left">
          <!-- Only the first letter: `capitalize` made it "Martes, 10 De Noviembre". -->
          <p class="text-[13px] font-medium text-ink-900 first-letter:uppercase">{{ slotLabel }}</p>
          <p v-if="offer?.appointmentTypeName" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ offer.appointmentTypeName }}</p>
          <p v-if="offer?.practitionerName" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ offer.practitionerName }}</p>
        </div>

        <UiBtn variant="primary" size="lg" class="mt-5 w-full" :disabled="phase === 'claiming'" @click="claim">
          {{ phase === 'claiming' ? 'Reservando…' : 'Reservar esta cita' }}
        </UiBtn>
        <p v-if="error" class="mt-3 text-sm text-danger-text" role="alert">{{ error }}</p>
      </template>

      <template v-else-if="phase === 'done'">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success-text">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
        </div>
        <h1 class="mt-4 text-lg font-semibold tracking-tightTitle text-ink-900">¡Cita reservada!</h1>
        <p class="mt-2 text-sm text-ink-muted">Ya puedes cerrar esta página. Te esperamos.</p>
      </template>
    </div>
  </div>
</template>
