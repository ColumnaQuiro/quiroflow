<script setup lang="ts">
// The second step of signing in: the six-digit code from the person's
// authenticator app. Shared with the mobile app (mobile/pages/index.vue).
const emit = defineEmits<{ verified: [] }>()

const t = useT()
const { verify } = useTwoFactor()

const code = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  const failure = await verify(code.value)
  loading.value = false
  if (failure) {
    error.value = twoFactorErrorText(failure, t)
    code.value = ''
    return
  }
  emit('verified')
}

// Authenticator apps show the code as "123 456"; submit as soon as six digits
// are in, typed or pasted, the way every other app that asks for one does.
watch(code, (value) => {
  if (value.replace(/\D/g, '').length === 6) submit()
})
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <label class="block text-sm font-medium text-ink-700" for="two-factor-code">{{ t('Authentication code', 'Código de verificación') }}</label>
      <p class="mt-0.5 text-[12.5px] text-ink-muted">
        {{ t('Open your authenticator app and enter the 6-digit code for QuiroFlow.', 'Abre tu app de autenticación e introduce el código de 6 dígitos de QuiroFlow.') }}
      </p>
      <input
        id="two-factor-code"
        v-model="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        placeholder="123456"
        autofocus
        required
        class="mt-2 w-full rounded-ctl border border-line-control px-3 py-2 text-center font-mono text-lg tracking-[.3em] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
    <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
      {{ loading ? t('Checking…', 'Comprobando…') : t('Verify', 'Verificar') }}
    </UiBtn>
    <p class="text-[12px] text-ink-faint">
      {{ t("Lost your phone? Ask your clinic's admin to reset two-factor for you under Settings → Team Members.", '¿Has perdido el móvil? Pide al administrador de tu clínica que restablezca tu verificación en dos pasos en Ajustes → Miembros del equipo.') }}
    </p>
  </form>
</template>
