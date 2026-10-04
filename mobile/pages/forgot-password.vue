<script setup lang="ts">
// The app had no way to reset a password at all: no link on its sign-in,
// and the reset pages only exist on the web. The request is made from here;
// the emailed link opens the web's reset page (the app is a static bundle
// with no page an email can land on), which sends a patient to the portal
// afterwards, and from there they come back to the app with the new
// password. ?portal=1 when this device is on the patient side keeps the
// web's back-links on the patient sign-in.
const supabase = useSupabaseClient()
const config = useRuntimeConfig()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const email = ref('')
const error = ref('')
const loading = ref(false)
const sent = ref(false)
const isPatient = ref(false)

const clinic = useClinicCode()
onMounted(async () => {
  clinic.prefill()
  if (!clinic.code.value) return
  isPatient.value = true
  try {
    await clinic.resolve()
  } catch {
    /* generic header */
  }
})

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${config.public.apiBase}/reset-password${isPatient.value ? '?portal=1' : ''}`,
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
  <OnboardingLayout :trust="false" embedded>
    <template v-if="isPatient" #brand>
      <AuthClinicBrand :name="clinic.clinicName.value || undefined" />
    </template>

    <template #heading>
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">
        {{ t('Reset your password', 'Recupera tu contraseña') }}
      </h1>
      <p v-if="!sent" class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">
        {{ t("Tell us your email and we'll send you a link to choose a new one.", 'Dinos tu correo y te enviamos un enlace para elegir una nueva.') }}
      </p>
    </template>

    <template #form>
      <div v-if="sent" class="mt-5">
        <div class="rounded-card border border-brand-tintBorder bg-brand-tint px-3.5 py-3 text-[14px] leading-[1.55] text-ink-700" role="status">
          {{ t('If an account exists for', 'Si existe una cuenta con') }} <strong class="font-semibold text-ink-900">{{ email }}</strong>{{
            t(
              ", we've sent a link to reset your password. Open it, choose a new password, then come back and sign in.",
              ', te hemos enviado un enlace. Ábrelo, elige una contraseña nueva y vuelve para entrar.',
            )
          }}
        </div>
        <NuxtLink to="/login" class="mt-5 block text-center text-[13.5px] font-semibold text-brand-text">
          &larr; {{ t('Back to sign in', 'Volver a iniciar sesión') }}
        </NuxtLink>
      </div>

      <form v-else class="mt-5 flex flex-col gap-[18px]" @submit.prevent="onSubmit">
        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>
        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Sending…', 'Enviando…')">
          {{ t('Send reset link', 'Enviar enlace') }}
        </OnboardingPrimaryButton>
        <NuxtLink to="/login" class="block text-center text-[13.5px] text-ink-muted">
          &larr; {{ t('Back to sign in', 'Volver a iniciar sesión') }}
        </NuxtLink>
      </form>
    </template>

    <!-- Without its own, the layout's default is signup's ("30-day trial,
         no card required"), which means nothing to someone resetting a
         password. -->
  </OnboardingLayout>
</template>
