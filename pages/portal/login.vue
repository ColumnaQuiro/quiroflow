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

async function onSubmit() {
  error.value = ''
  loading.value = true
  // A code, when there is one, has to be settled before the password goes
  // anywhere: it's what tells claim_patient_profile() which clinic's record
  // to link for a patient signing in for the first time
  // (middleware/portal.global.ts). With none, a patient already linked signs
  // in as they are, and the middleware's unscoped claim covers the rest --
  // it still refuses when the email matches at more than one clinic, which
  // is the case the code exists for.
  if (clinic.code.value.trim()) {
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
  }
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signInError) {
    error.value = authErrorMessage(signInError)
    return
  }
  await navigateTo('/portal')
}

// The clinic's link is passed along to sign-up, so a patient who taps
// "Create your account" does not have to type the code they arrived with.
const signupTo = computed(() => (clinic.code.value ? `/portal/signup?clinic=${encodeURIComponent(clinic.code.value)}` : '/portal/signup'))
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
      <AuthDoorSwitch current="patient" class="mb-7" />
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Patient sign in', 'Entra como paciente') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">
        {{ t('Your appointments, invoices and documents.', 'Tus citas, facturas y documentos de la clínica.') }}
      </p>
    </template>

    <template #form>
      <form class="mt-5 flex flex-col gap-[18px] lg:mt-[26px]" @submit.prevent="onSubmit">
        <AuthClinicField :clinic="clinic" :readonly="loading" optional />

        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>

        <OnboardingFormField id="password" :label="t('Password', 'Contraseña')">
          <template #aside>
            <!-- ?portal=1 is what sends them back to this screen afterwards
                 rather than to the staff sign-in. -->
            <NuxtLink to="/forgot-password?portal=1" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">
              {{ t('Forgot your password?', '¿La has olvidado?') }}
            </NuxtLink>
          </template>
          <OnboardingPasswordInput id="password" v-model="password" mode="current" :readonly="loading" />
        </OnboardingFormField>

        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Signing in…', 'Entrando…')">
          {{ t('Sign in', 'Entrar') }}
        </OnboardingPrimaryButton>

        <p class="text-center text-[13.5px] text-ink-muted">
          {{ t('First time here?', '¿Primera vez aquí?') }}
          <NuxtLink :to="signupTo" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('Create your account', 'Crea tu cuenta de paciente') }}</NuxtLink>
        </p>
      </form>
    </template>


    <template #preview>
      <AuthPreviewPortal :clinic-name="clinic.clinicName.value || undefined" />
    </template>
  </OnboardingLayout>
</template>
