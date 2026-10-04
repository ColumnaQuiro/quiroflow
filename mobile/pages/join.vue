<script setup lang="ts">
// The app's patient door: the clinic code, once. Same shell and switch as
// the web sign-in (components/auth), so a patient sees the same thing on
// the phone as in the browser.
const t = useT()
const { pingAppOpen } = useAppOpenPing()
const clinic = useClinicCode()
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const slug = clinic.normalize(clinic.code.value)
  const { error: rpcError } = await pingAppOpen(slug)
  loading.value = false
  if (rpcError) {
    error.value = t('Clinic code not found — check with your clinic.', 'No se encuentra ese código de clínica: consúltalo con tu clínica.')
    return
  }
  clinic.remember(slug)
  await navigateTo('/login')
}

// Staff already know their login and resolve via team_members, not the
// email-match RPC this code exists to disambiguate -- there's nothing for
// them to "join". clinic_gate_seen (not clinic_slug) marks the gate as
// handled so mobile/middleware/clinic-code.global.ts stops redirecting
// here, while leaving clinic_slug unset so useIdentity.ts's optional slug
// stays undefined for this device, same as before this gate existed.
function skipAsTeamMember() {
  localStorage.setItem('clinic_gate_seen', '1')
  navigateTo('/login')
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
      <AuthDoorSwitch current="patient" buttons class="mb-7" @select="skipAsTeamMember" />
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">
        {{ t('Join your clinic', 'Únete a tu clínica') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">
        {{
          t(
            'Enter the code your clinic gave you. Then sign in, or create your account with the email your clinic has on file for you.',
            'Introduce el código que te dio tu clínica. Después entra, o crea tu cuenta con el correo que tiene tu clínica.',
          )
        }}
      </p>
    </template>

    <template #form>
      <form class="mt-5 flex flex-col gap-[18px]" @submit.prevent="onSubmit">
        <AuthClinicField :clinic="clinic" :readonly="loading" />
        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Checking…', 'Comprobando…')">
          {{ t('Continue', 'Continuar') }}
        </OnboardingPrimaryButton>
      </form>
    </template>

    <template #trust>
      <p class="text-[12px] leading-relaxed text-ink-muted">
        {{ t('Your records are kept by your clinic, stored in the EU under GDPR.', 'Tus datos los guarda tu clínica, alojados en la UE conforme al RGPD.') }}
      </p>
    </template>

    <!-- Only an iPad in landscape is wide enough to show it. -->
    <template #preview>
      <AuthPreviewPortal :clinic-name="clinic.clinicName.value || undefined" />
    </template>
  </OnboardingLayout>
</template>
