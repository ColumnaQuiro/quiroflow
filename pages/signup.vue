<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const supabase = useSupabaseClient()
const authPasswordError = useAuthPasswordError()
const t = useT()

const email = ref('')
const password = ref('')
const emailError = ref('')
const formError = ref('')
const loading = ref(false)
const emailField = ref<{ focus: () => void } | null>(null)

// Carries a "Refer Your Friends!" link's ?ref=<account slug> through the
// two-step signup -> onboarding flow (the account referring row doesn't
// exist until onboarding.vue's create_account_with_owner call) the same
// way signup_intent already does for the staff-vs-patient distinction.
onMounted(() => {
  const ref = route.query.ref
  if (typeof ref === 'string' && ref) localStorage.setItem('signup_referred_by', ref)

  // Same trick, same reason, for where the visitor came from: the account
  // does not exist until onboarding.vue, and by then the query string that
  // brought them here is long gone. The marketing site forwards gclid and
  // the utm_* set onto this URL; the referrer is the fallback when an ad
  // network sent nothing. Written only when there is something to write, so
  // a direct visit never overwrites an earlier ad click in the same browser.
  const attribution: Record<string, string> = {}
  for (const key of ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term']) {
    const value = route.query[key]
    if (typeof value === 'string' && value) attribution[key] = value.slice(0, 200)
  }
  if (!Object.keys(attribution).length && document.referrer && !document.referrer.includes(location.host)) {
    attribution.referrer = document.referrer.slice(0, 200)
  }
  if (Object.keys(attribution).length) localStorage.setItem('signup_attribution', JSON.stringify(attribution))
})

// Supabase reports a taken address through a handful of wordings depending on
// whether confirmations are on. All of them mean the same thing to a clinic
// owner, and all of them deserve a route out rather than a raw API string.
function isAlreadyRegistered(message: string) {
  return /already registered|already exists|already been registered/i.test(message)
}

async function onSubmit() {
  if (loading.value) return
  emailError.value = ''
  formError.value = ''
  loading.value = true
  localStorage.setItem('signup_intent', 'staff')
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signUpError) {
    if (isAlreadyRegistered(signUpError.message)) {
      emailError.value = 'taken'
      await nextTick()
      emailField.value?.focus()
    } else {
      formError.value = authPasswordError(signUpError)
    }
    return
  }
  // An email that already has an account: with email confirmation on,
  // Supabase answers without an error (so as not to reveal who is signed up)
  // and with no identities on the user. It used to read as "check your email"
  // for a link that was never sent. An EMPTY list, not a missing one: a
  // response without the field says nothing either way.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    emailError.value = 'taken'
    await nextTick()
    emailField.value?.focus()
    return
  }
  if (data.session) {
    // Email confirmation is disabled on this project — session is live already.
    await navigateTo('/onboarding')
    return
  }
  // Handed over out of band rather than in the URL: the address is personal
  // data, and a query string ends up in history, logs and referrers.
  try {
    sessionStorage.setItem('signup_pending_email', email.value)
  } catch {
    // Private mode with storage blocked -- the next page falls back to a
    // generic "the address you just used".
  }
  await navigateTo('/check-email')
}
</script>

<template>
  <OnboardingLayout>
    <template #stepper>
      <OnboardingStepper :current="1" />
    </template>

    <template #heading>
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Create your QuiroFlow account', 'Crea tu cuenta de QuiroFlow') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:mt-[11px] lg:text-[15px]">
        {{
          t(
            'One account runs every clinic in your practice — schedules, patient records, reminders and invoicing.',
            'Una sola cuenta gestiona todas las clínicas de tu consulta: agendas, historiales, recordatorios y facturación.',
          )
        }}
      </p>
    </template>

    <template #form>
      <form class="mt-5 flex flex-col gap-[18px] lg:mt-[30px]" novalidate @submit.prevent="onSubmit">
        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')" :invalid="!!emailError">
          <OnboardingTextInput
            id="email"
            ref="emailField"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            :readonly="loading"
            :invalid="!!emailError"
            :described-by="emailError ? 'email-error' : undefined"
          />
          <template #error>
            {{ t('That email already has a QuiroFlow account.', 'Ese correo ya tiene una cuenta de QuiroFlow.') }}
            <NuxtLink to="/login" class="font-semibold text-danger-text underline">{{ t('Sign in', 'Inicia sesión') }}</NuxtLink>
            {{ t('instead, or use a different address.', 'o usa otra dirección.') }}
          </template>
        </OnboardingFormField>

        <OnboardingFormField id="password" :label="t('Password', 'Contraseña')">
          <OnboardingPasswordInput id="password" v-model="password" :readonly="loading" />
        </OnboardingFormField>

        <p v-if="formError" role="alert" class="text-[12.5px] text-danger-text">{{ formError }}</p>

        <OnboardingPrimaryButton
          class="mt-1.5"
          :loading="loading"
          :loading-label="t('Creating account…', 'Creando la cuenta…')"
        >
          {{ t('Create account', 'Crear cuenta') }}
        </OnboardingPrimaryButton>

        <p v-if="loading" class="flex items-center justify-center gap-1.5 text-[12.5px] text-ink-muted">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-[13px] w-[13px]">
            <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.8" stroke="currentColor" stroke-width="1.4" />
            <path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <span>{{ t('Setting up your encrypted practice workspace in the EU…', 'Preparando tu espacio de trabajo cifrado en la UE…') }}</span>
        </p>

        <p v-else class="text-center text-[13.5px] text-ink-muted">
          {{ t('Already using QuiroFlow?', '¿Ya usas QuiroFlow?') }}
          <NuxtLink to="/login" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('Sign in', 'Inicia sesión') }}</NuxtLink>
        </p>
      </form>
    </template>

    <template #preview>
      <OnboardingPreviewCalendar />
    </template>
  </OnboardingLayout>
</template>
