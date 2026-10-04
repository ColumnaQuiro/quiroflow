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
  <form class="flex flex-col gap-[18px]" @submit.prevent="submit">
    <!-- Same field and button as the sign-in pages (OnboardingTextInput /
         OnboardingPrimaryButton), since this is the step straight after
         them; the code input keeps its own wide, centred digits. -->
    <OnboardingFormField
      id="two-factor-code"
      :label="t('Authentication code', 'Código de verificación')"
      :description="t('Open your authenticator app and enter the 6-digit code for QuiroFlow.', 'Abre tu app de autenticación e introduce el código de 6 dígitos de QuiroFlow.')"
      :error="error || undefined"
    >
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
        :readonly="loading"
        :aria-invalid="!!error || undefined"
        class="h-12 w-full rounded-ctl border border-line-control bg-surface px-3 text-center font-mono text-[20px] tracking-[.3em] text-ink-900 outline-none transition-shadow placeholder:text-ink-faint focus:border-brand focus:shadow-focus"
      />
    </OnboardingFormField>
    <OnboardingPrimaryButton :loading="loading" :loading-label="t('Checking…', 'Comprobando…')">
      {{ t('Verify', 'Verificar') }}
    </OnboardingPrimaryButton>
    <p class="text-[12.5px] leading-[1.5] text-ink-muted">
      {{ t("Lost your phone? Ask your clinic's admin to reset two-factor for you under Settings → Team.", '¿Has perdido el móvil? Pide al administrador de tu clínica que restablezca tu verificación en dos pasos en Ajustes → Equipo.') }}
    </p>
  </form>
</template>
