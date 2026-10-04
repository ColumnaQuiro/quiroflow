<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const { gate } = useTwoFactor()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  if (signInError) {
    loading.value = false
    error.value = authErrorMessage(signInError)
    return
  }
  // Asked here rather than left to middleware/account.global.ts: straight
  // after signInWithPassword, useSupabaseUser() has not caught up yet, so the
  // middleware sees nobody signed in and waves /dashboard through without
  // ever reaching its two-factor check. The session itself is already here.
  const twoFactor = await gate()
  loading.value = false
  await navigateTo(twoFactor === 'ok' ? '/dashboard' : '/two-factor')
}
</script>

<template>
  <OnboardingLayout :trust="false">
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <AuthDoorSwitch current="staff" class="mb-7" />
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Sign in', 'Inicia sesión') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">
        {{ t("Your clinic's calendar, patient records and invoicing.", 'Agenda, fichas y facturación de tu clínica.') }}
      </p>
    </template>

    <template #form>
      <form class="mt-5 flex flex-col gap-[18px] lg:mt-[26px]" @submit.prevent="onSubmit">
        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>

        <OnboardingFormField id="password" :label="t('Password', 'Contraseña')">
          <template #aside>
            <NuxtLink to="/forgot-password" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">
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
          {{ t('Clinic not on QuiroFlow yet?', '¿Tu clínica aún no usa QuiroFlow?') }}
          <NuxtLink to="/signup" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('Create an account', 'Crea una cuenta') }}</NuxtLink>
        </p>
      </form>
    </template>


    <template #preview>
      <OnboardingPreviewCalendar
        eyebrow="QuiroFlow"
        :title="t('Your clinic, in one place', 'Tu clínica, en un solo sitio')"
        :body="
          t(
            'Calendar, patient records, reminders and invoicing, for every clinic in your practice.',
            'Agenda, historiales, recordatorios y facturación, para todas las clínicas de tu consulta.',
          )
        "
      />
    </template>
  </OnboardingLayout>
</template>
