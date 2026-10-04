<script setup lang="ts">
const supabase = useSupabaseClient()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const checkEmail = ref(false)

// The patient's clinic, from /join: named at the top, as on the web sign-up.
const clinic = useClinicCode()
onMounted(async () => {
  clinic.prefill()
  if (!clinic.code.value) return
  try {
    await clinic.resolve()
  } catch {
    /* generic header */
  }
})

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signUpError) {
    error.value = authErrorMessage(signUpError)
    return
  }
  if (data.session) {
    ;(document.activeElement as HTMLElement | null)?.blur()
    await new Promise((resolve) => setTimeout(resolve, 350))
    await navigateTo('/')
    return
  }
  checkEmail.value = true
  startResendCountdown()
}

// A link lost to spam used to mean starting again with a new address.
const resendIn = ref(0)
const resending = ref(false)
const resent = ref(false)
const resendError = ref('')
let timer: ReturnType<typeof setInterval> | undefined

function startResendCountdown() {
  resendIn.value = 60
  clearInterval(timer)
  timer = setInterval(() => {
    if (resendIn.value > 0) resendIn.value -= 1
  }, 1000)
}
onBeforeUnmount(() => clearInterval(timer))

const countdown = computed(() => `${Math.floor(resendIn.value / 60)}:${String(resendIn.value % 60).padStart(2, '0')}`)

async function resend() {
  if (resendIn.value > 0 || resending.value) return
  resending.value = true
  resendError.value = ''
  resent.value = false
  const { error: resendFailure } = await supabase.auth.resend({ type: 'signup', email: email.value })
  resending.value = false
  if (resendFailure) {
    resendError.value = authErrorMessage(resendFailure)
    return
  }
  resent.value = true
  startResendCountdown()
}

function useDifferentEmail() {
  checkEmail.value = false
  resent.value = false
  resendError.value = ''
  password.value = ''
}
</script>

<template>
  <OnboardingLayout embedded>
    <template #brand>
      <AuthClinicBrand :name="clinic.clinicName.value || undefined" />
    </template>
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <template v-if="!checkEmail">
        <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">
          {{ t('Create your patient account', 'Crea tu cuenta de paciente') }}
        </h1>
        <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">
          {{ t('Use the same email your clinic has on file for you -- that is how we find your record.', 'Usa el mismo correo que tiene tu clínica: así encontramos tu ficha.') }}
        </p>
      </template>
      <template v-else>
        <div class="flex h-[46px] w-[46px] items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-[22px] w-[22px] text-brand-text">
            <rect x="3" y="5.5" width="18" height="13" rx="2.6" stroke="currentColor" stroke-width="1.6" />
            <path d="M3.8 7L12 12.8L20.2 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <h1 class="mt-5 text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">{{ t('Check your email', 'Revisa tu correo') }}</h1>
        <p class="mt-3 text-[14.5px] leading-[1.6] text-ink-muted">
          {{ t('We sent a confirmation link to', 'Te hemos enviado un enlace de confirmación a') }}
          <strong class="font-semibold text-ink-900">{{ email }}</strong>.
          {{ t('Open it, then come back and sign in.', 'Ábrelo y vuelve para iniciar sesión.') }}
        </p>
      </template>
    </template>

    <template #form>
      <form v-if="!checkEmail" class="mt-5 flex flex-col gap-[18px]" @submit.prevent="onSubmit">
        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>
        <OnboardingFormField id="password" :label="t('Password', 'Contraseña')">
          <OnboardingPasswordInput id="password" v-model="password" :readonly="loading" />
        </OnboardingFormField>
        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Creating account…', 'Creando la cuenta…')">
          {{ t('Create account', 'Crear cuenta') }}
        </OnboardingPrimaryButton>
        <p class="text-center text-[13.5px] text-ink-muted">
          {{ t('Already have an account?', '¿Ya tienes cuenta?') }}
          <NuxtLink to="/login" class="font-semibold text-brand-text">{{ t('Sign in', 'Entra') }}</NuxtLink>
        </p>
      </form>

      <div v-else>
        <div class="mt-6 flex flex-wrap items-center gap-3">
          <OnboardingSecondaryButton :disabled="resendIn > 0 || resending" @click="resend">
            {{ resending ? t('Sending…', 'Enviando…') : t('Resend link', 'Reenviar enlace') }}
          </OnboardingSecondaryButton>
          <span v-if="resendIn > 0" class="text-[13px] text-ink-muted" aria-live="off">
            {{ t(`You can resend in ${countdown}`, `Puedes reenviarlo en ${countdown}`) }}
          </span>
          <span v-if="resent" class="text-[13px] font-semibold text-success-text" role="status">{{ t('Sent again.', 'Enviado de nuevo.') }}</span>
        </div>
        <p v-if="resendError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ resendError }}</p>
        <p class="mt-5 border-t border-line-divider pt-[18px] text-[13.5px] leading-[1.55] text-ink-muted">
          {{ t('Nothing arrived? Check spam, or', '¿No ha llegado? Mira en spam, o') }}
          <button type="button" class="font-semibold text-brand-text" @click="useDifferentEmail">{{ t('use a different email', 'usa otro correo') }}</button>.
        </p>
        <NuxtLink to="/login" class="mt-5 block text-center text-[13.5px] font-semibold text-brand-text">
          &larr; {{ t('Back to sign in', 'Volver a iniciar sesión') }}
        </NuxtLink>
      </div>
    </template>

    <template #trust>
      <p class="text-[12px] leading-relaxed text-ink-muted">
        {{ t('Your records are kept by your clinic, stored in the EU under GDPR.', 'Tus datos los guarda tu clínica, alojados en la UE conforme al RGPD.') }}
      </p>
    </template>

    <template #preview>
      <AuthPreviewPortal :clinic-name="clinic.clinicName.value || undefined" />
    </template>
  </OnboardingLayout>
</template>
