<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const authPasswordError = useAuthPasswordError()
const user = useSupabaseUser()
const route = useRoute()
const t = useT()

// Where a successful reset sends them. This used to be a hardcoded
// '/dashboard', which is the STAFF dashboard -- a patient resetting their
// password was dropped somewhere they have no access to.
//
// Identity is the authority, not the ?portal=1 hint: useIdentity() resolves
// the same patient/team_member split the portal middleware and the mobile app
// already go through (and claims an unlinked patient profile on the way, which
// a freshly reset patient account may still need). Both can be set -- a
// practitioner who is also a patient of their own clinic -- and staff wins
// there, since the dashboard is their working screen. The hint only decides it
// when neither resolves, e.g. a link opened before the profile could be
// claimed.
const { patient, teamMember } = useIdentity()
const destination = computed(() => {
  if (teamMember.value) return '/dashboard'
  if (patient.value) return '/portal'
  return route.query.portal ? '/portal' : '/dashboard'
})
// Which side's header and preview the page wears; the destination above is
// still decided by identity.
const isPortal = computed(() => !!route.query.portal)
const destinationLabel = computed(() =>
  destination.value === '/portal' ? t('your portal', 'tu espacio de paciente') : t('your dashboard', 'tu panel'),
)

const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const done = ref(false)

async function onSubmit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = t('Password must be at least 8 characters.', 'La contraseña debe tener al menos 8 caracteres.')
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = t('Passwords do not match.', 'Las contraseñas no coinciden.')
    return
  }
  loading.value = true
  const { error: updateError } = await supabase.auth.updateUser({ password: password.value })
  loading.value = false
  if (updateError) {
    error.value = authPasswordError(updateError)
    return
  }
  done.value = true
  setTimeout(() => navigateTo(destination.value), 1500)
}
</script>

<template>
  <AuthShell :portal="isPortal">
    <template #heading>
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Set a new password', 'Elige una contraseña nueva') }}
      </h1>
    </template>

    <template #form>
      <p v-if="done" class="mt-5 text-[14px] font-medium text-success-text" role="status">
        {{ t(`Password updated. Taking you to ${destinationLabel}…`, `Contraseña cambiada. Te llevamos a ${destinationLabel}…`) }}
      </p>

      <p v-else-if="!user" class="mt-4 text-[14.5px] leading-[1.55] text-ink-muted">
        {{ t('This link is invalid or has expired.', 'Este enlace no es válido o ha caducado.') }}
        <NuxtLink :to="isPortal ? '/forgot-password?portal=1' : '/forgot-password'" class="font-semibold text-brand-text hover:text-brand-hover">{{
          t('Request a new one', 'Pide uno nuevo')
        }}</NuxtLink>.
      </p>

      <form v-else class="mt-5 flex flex-col gap-[18px] lg:mt-[26px]" @submit.prevent="onSubmit">
        <OnboardingFormField id="password" :label="t('New password', 'Contraseña nueva')">
          <OnboardingPasswordInput id="password" v-model="password" :min-length="8" :readonly="loading" />
        </OnboardingFormField>
        <OnboardingFormField id="confirm" :label="t('Confirm new password', 'Repite la contraseña nueva')">
          <OnboardingTextInput id="confirm" v-model="confirmPassword" type="password" autocomplete="new-password" required :readonly="loading" />
        </OnboardingFormField>
        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Saving…', 'Guardando…')">
          {{ t('Update password', 'Cambiar contraseña') }}
        </OnboardingPrimaryButton>
      </form>
    </template>
  </AuthShell>
</template>
