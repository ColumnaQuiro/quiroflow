<script setup lang="ts">
// The one-click half of Settings > WhatsApp. Everything below it on that page
// is the manual route -- four values copied out of a Meta app the clinic had
// to create themselves -- and this exists to make that the exception rather
// than the only way in.

const props = defineProps<{ connectedWabaId: string | null }>()
const emit = defineEmits<{ connected: [] }>()

const t = useT()
const { showToast } = useToast()
const { available, launch } = useEmbeddedSignup()

const busy = ref(false)

async function connect() {
  busy.value = true
  try {
    const code = await launch()
    const result = await useStaffFetch<{ displayPhoneNumber: string | null }>('/api/meta/connect/callback', {
      method: 'POST',
      body: { code },
    })
    showToast(
      result.displayPhoneNumber
        ? t(`WhatsApp connected on ${result.displayPhoneNumber}.`, `WhatsApp conectado en ${result.displayPhoneNumber}.`)
        : t('WhatsApp connected.', 'WhatsApp conectado.'),
      'success',
    )
    emit('connected')
  } catch (err: any) {
    // Closing the dialog is not a failure and must not be shouted about --
    // people open it to look, decide they need their Meta login first, and
    // close it. A red toast there reads as "something went wrong".
    if (err?.message === 'CANCELLED') return
    showToast(err?.data?.statusMessage ?? err?.message ?? t('Could not connect WhatsApp.', 'No se pudo conectar WhatsApp.'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="available" class="rounded-card border border-line-control bg-surface p-4" data-test="whatsapp-connect-card">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-[13.5px] font-[560] text-ink-900">{{ t('Connect WhatsApp', 'Conectar WhatsApp') }}</p>
        <!-- The number itself is not stored anywhere, so it is not claimed
        here. It is in the toast the moment the connection lands, which is
        when someone actually wants to check it. -->
        <p v-if="props.connectedWabaId" class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2" data-test="whatsapp-connected-state">
          {{ t('Connected to a WhatsApp Business account.', 'Conectado a una cuenta de WhatsApp Business.') }}
        </p>
        <p v-else class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2">
          {{ t('Sign in with Meta and pick your WhatsApp number. Nothing to copy across — no Meta app, no tokens.', 'Inicia sesión con Meta y elige tu número de WhatsApp. Nada que copiar — sin app de Meta, sin tokens.') }}
        </p>
      </div>
      <UiBtn variant="primary" :disabled="busy" data-test="whatsapp-connect-button" @click="connect">
        {{ busy ? t('Connecting…', 'Conectando…') : props.connectedWabaId ? t('Reconnect', 'Reconectar') : t('Connect', 'Conectar') }}
      </UiBtn>
    </div>
  </div>
</template>
