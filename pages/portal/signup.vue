<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const clinic = useClinicCode()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const checkEmail = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  // Stored before the account is created, not after: sign-up usually ends
  // at "check your email", and the profile only gets claimed once the
  // patient follows that link back -- by which point this form is long
  // gone and the slug in localStorage is the only record of which clinic
  // they were signing up to.
  let slug: string
  try {
    slug = await clinic.resolve()
  } catch {
    loading.value = false
    error.value = t(
      'Clinic code not found -- check the code your clinic gave you.',
      'No encontramos ese código de clínica: revisa el que te dio tu clínica.',
    )
    return
  }
  clinic.remember(slug)
  localStorage.setItem('signup_intent', 'portal')
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signUpError) {
    error.value = authErrorMessage(signUpError)
    return
  }
  // An email that already has an account: with email confirmation on,
  // Supabase answers without an error (so as not to reveal who is signed up)
  // and with no identities on the user. It used to read as "check your email"
  // for a link that was never sent. An EMPTY list, not a missing one: a
  // response without the field says nothing either way.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    error.value = t('There is already an account with this email. Sign in, or reset your password.', 'Ya hay una cuenta con este correo. Entra o recupera tu contraseña.')
    return
  }
  if (data.session) {
    await navigateTo('/portal')
    return
  }
  checkEmail.value = true
  startResendCountdown()
}

// The staff check-email page has had a resend for a while; the patient one
// had none, so a link lost to spam meant starting again with a new address.
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
  <OnboardingLayout :trust="false">
    <template #brand>
      <AuthClinicBrand :name="clinic.clinicName.value || undefined" />
    </template>
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <template v-if="!checkEmail">
        <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
          {{ t('Create your patient account', 'Crea tu cuenta de paciente') }}
        </h1>
        <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">
          {{
            t(
              'Use the same email your clinic has on file for you -- that is how we find your record.',
              'Usa el mismo correo que tiene tu clínica: así encontramos tu ficha.',
            )
          }}
        </p>
      </template>
      <template v-else>
        <div class="flex h-[46px] w-[46px] items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-[22px] w-[22px] text-brand-text">
            <rect x="3" y="5.5" width="18" height="13" rx="2.6" stroke="currentColor" stroke-width="1.6" />
            <path d="M3.8 7L12 12.8L20.2 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <h1 class="mt-5 text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
          {{ t('Check your email', 'Revisa tu correo') }}
        </h1>
        <p class="mt-3 text-[14.5px] leading-[1.6] text-ink-muted lg:text-[15px]">
          {{ t('We sent a confirmation link to', 'Te hemos enviado un enlace de confirmación a') }}
          <strong class="font-semibold text-ink-900">{{ email }}</strong>.
          {{ t('Click it to finish setting up your account.', 'Ábrelo para terminar de crear tu cuenta.') }}
        </p>
      </template>
    </template>

    <template #form>
      <form v-if="!checkEmail" class="mt-5 flex flex-col gap-[18px] lg:mt-[26px]" @submit.prevent="onSubmit">
        <AuthClinicField :clinic="clinic" :readonly="loading" />

        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="email" required :readonly="loading" />
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
          <NuxtLink to="/portal/login" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('Sign in', 'Entra') }}</NuxtLink>
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
          <span v-if="resent" class="text-[13px] font-semibold text-success-text" role="status">
            {{ t('Sent again.', 'Enviado de nuevo.') }}
          </span>
        </div>
        <p v-if="resendError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ resendError }}</p>

        <p class="mt-5 border-t border-line-divider pt-[18px] text-[13.5px] leading-[1.55] text-ink-muted">
          {{ t('Nothing arrived? Check spam, or', '¿No ha llegado? Mira en spam, o') }}
          <button type="button" class="font-semibold text-brand-text hover:text-brand-hover" @click="useDifferentEmail">
            {{ t('use a different email', 'usa otro correo') }}</button>.
        </p>
      </div>
    </template>


    <template #preview>
      <AuthPreviewPortal :clinic-name="clinic.clinicName.value || undefined" />
    </template>
  </OnboardingLayout>
</template>
