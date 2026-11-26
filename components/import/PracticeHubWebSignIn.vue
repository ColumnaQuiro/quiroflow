<script setup lang="ts">
import type { PracticeHubWebStatus } from '~/composables/usePracticeHubWeb'

// The clinic's sign-in to PracticeHub's website, shared by the steps whose
// server jobs read it (Signed forms, Invoice originals): the verification
// code PracticeHub may ask for, the email and password, and once saved, who
// it signs in as. The step's own controls go in the slot, shown while a
// sign-in is saved and not being changed.
const props = defineProps<{
  status: PracticeHubWebStatus
  busy: boolean
  /** A job is running: the sign-in it uses is not to be changed under it. */
  locked: boolean
  act: (body: Record<string, unknown>) => Promise<boolean>
}>()

const t = useT()
const email = ref('')
const password = ref('')
const code = ref('')
const changing = ref(false)
const resent = ref(false)

async function connect() {
  if (!email.value.trim() || !password.value) return
  if (await props.act({ op: 'connect', email: email.value.trim(), password: password.value })) {
    password.value = ''
    changing.value = false
  }
}

async function sendCode() {
  if (await props.act({ op: 'code', code: code.value })) code.value = ''
}

async function resend(via: 'email' | 'sms') {
  resent.value = await props.act({ op: 'resend', via })
}

async function forget() {
  if (await props.act({ op: 'forget' })) {
    email.value = ''
    changing.value = false
  }
}

const fieldId = useId()
const inputClass = 'mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div>
    <!-- A code PracticeHub is waiting for. Above everything else: nothing moves until it is typed. -->
    <form v-if="status.code" class="mt-4 max-w-md space-y-3 rounded-card border border-warning-border bg-warning-bg p-4" data-cy="ph-web-code" @submit.prevent="sendCode">
      <p class="text-[13px] font-medium text-ink-900">{{ t('PracticeHub is asking for a verification code', 'PracticeHub pide un código de verificación') }}</p>
      <p class="text-[12.5px] text-ink-700">
        {{ status.code.method === 'app'
          ? t('Enter the code from the authenticator app you use for PracticeHub.', 'Escribe el código de la aplicación de autenticación que usas con PracticeHub.')
          : t(`PracticeHub has just sent a code to ${status.email}. Enter it here.`, `PracticeHub acaba de enviar un código a ${status.email}. Escríbelo aquí.`) }}
      </p>
      <div>
        <label :for="`${fieldId}-code`" class="block text-sm font-medium text-ink-700">{{ t('Verification code', 'Código de verificación') }}</label>
        <input :id="`${fieldId}-code`" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" required :class="inputClass" data-cy="ph-web-code-input" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UiBtn variant="primary" type="submit" :disabled="busy">{{ t('Confirm code', 'Confirmar código') }}</UiBtn>
        <template v-if="status.code.method === 'email'">
          <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy" @click="resend('email')">{{ t('Send it again by email', 'Enviar de nuevo por correo') }}</button>
          <button v-if="status.code.phone" type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy" @click="resend('sms')">{{ t(`Send by SMS to ${status.code.phone}`, `Enviar por SMS al ${status.code.phone}`) }}</button>
        </template>
      </div>
      <p v-if="resent" class="text-[12.5px] text-ink-muted2">{{ t('PracticeHub was asked to send a new code.', 'Se ha pedido a PracticeHub un código nuevo.') }}</p>
    </form>

    <form v-if="!status.email || changing" class="mt-4 max-w-md space-y-4" data-cy="ph-web-connect" @submit.prevent="connect">
      <div>
        <label :for="`${fieldId}-email`" class="block text-sm font-medium text-ink-700">{{ t('Email you sign in to PracticeHub with', 'Correo con el que entras en PracticeHub') }}</label>
        <input :id="`${fieldId}-email`" v-model="email" type="email" autocomplete="off" required :class="inputClass" data-cy="ph-web-email" />
      </div>
      <div>
        <label :for="`${fieldId}-password`" class="block text-sm font-medium text-ink-700">{{ t('PracticeHub password', 'Contraseña de PracticeHub') }}</label>
        <input :id="`${fieldId}-password`" v-model="password" type="password" autocomplete="new-password" required :class="inputClass" data-cy="ph-web-password" />
        <p class="mt-1 text-[12px] text-ink-faint">{{ t('An account that only signs in with Google has no password: set one in PracticeHub first.', 'Una cuenta que solo entra con Google no tiene contraseña: ponle una antes en PracticeHub.') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <UiBtn variant="primary" type="submit" :disabled="busy" data-cy="ph-web-connect-submit">{{ busy ? t('Signing in…', 'Entrando…') : t('Sign in to PracticeHub', 'Entrar en PracticeHub') }}</UiBtn>
        <button v-if="changing" type="button" class="text-sm font-medium text-ink-600 hover:underline" @click="changing = false">{{ t('Cancel', 'Cancelar') }}</button>
      </div>
    </form>

    <div v-else class="mt-4 space-y-4">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-700">
        <span data-cy="ph-web-connected">{{ status.connected ? t(`Signed in to PracticeHub as ${status.email}`, `Sesión iniciada en PracticeHub como ${status.email}`) : t(`Saved sign-in: ${status.email}`, `Acceso guardado: ${status.email}`) }}</span>
        <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy || locked" @click="changing = true">{{ t('Change', 'Cambiar') }}</button>
        <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy || locked" @click="forget">{{ t('Remove', 'Quitar') }}</button>
      </div>
      <slot />
    </div>
  </div>
</template>
