<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const route = useRoute()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const email = ref('')
const error = ref('')
const loading = ref(false)
const sent = ref(false)

// This page is shared by staff and patients, and the two have different sign-in
// screens to go back to. The portal's "Forgot your password?" link carries
// ?portal=1 so both the back-links here and the redirect the emailed link lands
// on stay on the patient side -- otherwise a patient resetting their password
// is handed the staff login, which they can't use.
const isPortal = computed(() => !!route.query.portal)
const signInPath = computed(() => (isPortal.value ? '/portal/login' : '/login'))

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${window.location.origin}/reset-password${isPortal.value ? '?portal=1' : ''}`,
  })
  loading.value = false
  if (resetError) {
    error.value = authErrorMessage(resetError)
    return
  }
  sent.value = true
}
</script>

<template>
  <AuthShell :portal="isPortal">
    <template #heading>
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Reset your password', 'Recupera tu contraseña') }}
      </h1>
      <p v-if="!sent" class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">
        {{ t("Tell us your email and we'll send you a link to choose a new one.", 'Dinos tu correo y te enviamos un enlace para elegir una nueva.') }}
      </p>
    </template>

    <template #form>
      <div v-if="sent" class="mt-5 lg:mt-[22px]">
        <div class="rounded-card border border-brand-tintBorder bg-brand-tint px-3.5 py-3 text-[14px] leading-[1.55] text-ink-700" role="status">
          {{ t('If an account exists for', 'Si existe una cuenta con') }} <strong class="font-semibold text-ink-900">{{ email }}</strong>{{
            t(", we've sent a link to reset your password. Check your inbox.", ', te hemos enviado un enlace para cambiar la contraseña. Revisa tu bandeja de entrada.')
          }}
        </div>
        <NuxtLink :to="signInPath" class="mt-5 block text-center text-[13.5px] font-semibold text-brand-text hover:text-brand-hover">
          &larr; {{ t('Back to sign in', 'Volver a iniciar sesión') }}
        </NuxtLink>
      </div>

      <form v-else class="mt-5 flex flex-col gap-[18px] lg:mt-[26px]" @submit.prevent="onSubmit">
        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>
        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Sending…', 'Enviando…')">
          {{ t('Send reset link', 'Enviar enlace') }}
        </OnboardingPrimaryButton>
        <NuxtLink :to="signInPath" class="block text-center text-[13.5px] text-ink-muted hover:text-ink-700">
          &larr; {{ t('Back to sign in', 'Volver a iniciar sesión') }}
        </NuxtLink>
      </form>
    </template>
  </AuthShell>
</template>
