<script setup lang="ts">
// The one-click half of Settings > WhatsApp. Everything below it on that page
// is the manual route -- four values copied out of a Meta app the clinic had
// to create themselves -- and this exists to make that the exception rather
// than the only way in.
//
// Two ways through Meta's dialog, and the clinic picks before opening it,
// because Meta will not switch a number from one to the other afterwards
// without disconnecting it:
//
// - 'app': the number the clinic ALREADY uses in the WhatsApp Business app.
//   Meta's Coexistence: the phone keeps working as before, and QuiroFlow
//   sends and receives on the same number alongside it. What the clinic
//   writes from the phone reaches the Inbox too (smb_message_echoes).
// - 'api': a number for QuiroFlow only. It leaves the app, if it was ever on
//   it. The only option there was until Coexistence.
//
// 'app' is the default because it is what almost every clinic has: one
// number, on the receptionist's phone, which they are not about to give up.

const props = defineProps<{ connectedWabaId: string | null; businessAppSince?: string | null }>()
const emit = defineEmits<{ connected: [] }>()

const t = useT()
const { showToast } = useToast()
const { available, launch } = useEmbeddedSignup()

const busy = ref(false)
const mode = ref<'app' | 'api'>('app')
// The choice is server-rendered before Vue owns it. Picked in that gap, the
// browser moves the radio and hydration then moves it back to 'app' -- so the
// clinic would see "a number for QuiroFlow only" ticked and connect the other
// way. Disabled until mounted, which is also what lets Cypress wait for it.
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))

const options = computed(() => [
  {
    value: 'app' as const,
    title: t('I use this number in the WhatsApp Business app', 'Uso este número en la app WhatsApp Business'),
    text: t(
      'Keep using the app on your phone. QuiroFlow sends reminders and answers on the same number, and what you write from the phone shows up in the Inbox.',
      'Sigue usando la app en el móvil. QuiroFlow envía recordatorios y responde con el mismo número, y lo que escribas desde el móvil aparece en el Inbox.',
    ),
  },
  {
    value: 'api' as const,
    title: t('A number for QuiroFlow only', 'Un número solo para QuiroFlow'),
    text: t(
      'A new number, or one you will stop using in the app. It will no longer work in the WhatsApp app.',
      'Un número nuevo, o uno que dejarás de usar en la app. Dejará de funcionar en la app de WhatsApp.',
    ),
  },
])

async function connect() {
  busy.value = true
  try {
    const businessApp = mode.value === 'app'
    const code = await launch({ businessApp })
    const result = await useStaffFetch<{ displayPhoneNumber: string | null; businessApp: boolean }>('/api/meta/connect/callback', {
      method: 'POST',
      body: { code, businessApp },
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
        <template v-if="props.connectedWabaId">
          <p class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2" data-test="whatsapp-connected-state">
            {{ t('Connected to a WhatsApp Business account.', 'Conectado a una cuenta de WhatsApp Business.') }}
          </p>
          <!-- Said because Meta disconnects a shared number when the phone
          goes unused, and nothing in QuiroFlow could warn them beforehand. -->
          <p v-if="props.businessAppSince" class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2" data-test="whatsapp-business-app-state">
            {{
              t(
                'Also in use in the WhatsApp Business app on your phone. Open the app at least every two weeks, or Meta disconnects the number.',
                'También en uso en la app WhatsApp Business del móvil. Abre la app al menos cada dos semanas, o Meta desconecta el número.',
              )
            }}
          </p>
        </template>
        <p v-else class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2">
          {{ t('Sign in with Meta and pick your WhatsApp number. Nothing to copy across — no Meta app, no tokens.', 'Inicia sesión con Meta y elige tu número de WhatsApp. Nada que copiar — sin app de Meta, sin tokens.') }}
        </p>
      </div>
      <UiBtn variant="primary" :disabled="busy || !hydrated" data-test="whatsapp-connect-button" @click="connect">
        {{ busy ? t('Connecting…', 'Conectando…') : props.connectedWabaId ? t('Reconnect', 'Reconectar') : t('Connect', 'Conectar') }}
      </UiBtn>
    </div>

    <fieldset class="mt-3 overflow-hidden rounded-card border border-line-row" data-test="whatsapp-connect-mode">
      <legend class="sr-only">{{ t('Which number are you connecting?', '¿Qué número vas a conectar?') }}</legend>
      <label
        v-for="(opt, i) in options"
        :key="opt.value"
        class="flex cursor-pointer items-start gap-3 px-3.5 py-3"
        :class="[mode === opt.value ? 'bg-brand-tint' : '', i > 0 ? 'border-t border-line-row' : '']"
      >
        <input v-model="mode" type="radio" name="whatsapp-connect-mode" :value="opt.value" :data-test="`whatsapp-connect-mode-${opt.value}`" :disabled="busy || !hydrated" class="mt-0.5 h-4 w-4 accent-brand" />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <strong class="text-[13.5px] font-[560] text-ink-900">{{ opt.title }}</strong>
          <span class="text-[12.5px] leading-relaxed text-ink-500">{{ opt.text }}</span>
        </span>
      </label>
    </fieldset>
  </div>
</template>
