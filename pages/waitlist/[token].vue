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
    error.value = e?.data?.statusMessage ?? 'Este enlace no es válido o ha caducado.'
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
    error.value = e?.data?.statusMessage ?? 'No se ha podido reservar esta cita.'
    phase.value = 'ready'
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-card">
      <div v-if="phase === 'loading'" class="text-sm text-ink-faint">Cargando…</div>

      <div v-else-if="phase === 'invalid'" class="text-sm text-danger-text">{{ error }}</div>

      <template v-else-if="phase === 'ready' || phase === 'claiming'">
        <h1 class="text-lg font-semibold text-ink-900">¡Se ha liberado una cita!</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ offer?.clinicName }}</p>

        <div class="mt-4 rounded-ctl border border-line-control bg-surface-subtle p-3 text-left">
          <p class="text-[13px] font-medium capitalize text-ink-900">{{ slotLabel }}</p>
          <p v-if="offer?.appointmentTypeName" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ offer.appointmentTypeName }}</p>
          <p v-if="offer?.practitionerName" class="mt-0.5 text-[12.5px] text-ink-muted2">{{ offer.practitionerName }}</p>
        </div>

        <button
          type="button"
          class="mt-5 flex w-full items-center justify-center rounded-ctl bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          :disabled="phase === 'claiming'"
          @click="claim"
        >
          {{ phase === 'claiming' ? 'Reservando…' : 'Reservar esta cita' }}
        </button>
        <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      </template>

      <template v-else-if="phase === 'done'">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
        <h1 class="mt-4 text-lg font-semibold text-ink-900">¡Cita reservada!</h1>
        <p class="mt-2 text-sm text-ink-muted">Ya puedes cerrar esta página. Te esperamos.</p>
      </template>
    </div>
  </div>
</template>
