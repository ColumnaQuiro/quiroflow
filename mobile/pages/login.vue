<script setup lang="ts">
const supabase = useSupabaseClient()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
const clinic = useClinicCode()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// One sign-in serves both sides in the app; which one this device is on is
// whatever /join left behind. A stored clinic code means a patient (the
// clinic's name heads the page); "I'm on the team" leaves none.
const side = ref<'staff' | 'patient'>('staff')
onMounted(async () => {
  clinic.prefill()
  if (!clinic.code.value) return
  side.value = 'patient'
  try {
    await clinic.resolve()
  } catch {
    /* the generic patient header; /join is one tap away via Change */
  }
})

// Once "I'm on the clinic's team" is tapped on /join, clinic_gate_seen is
// set permanently and there was no way back to /join to instead enter a
// patient's clinic code -- clearing both localStorage keys and returning
// there resets the choice entirely, same fresh state as a new install.
function backToJoin() {
  localStorage.removeItem('clinic_gate_seen')
  localStorage.removeItem('clinic_slug')
  navigateTo('/join')
}

// The other way: a patient's device handed to a member of staff. Staff
// resolve through team_members and need no code, so it is dropped (as
// /join's own "I'm on the team" never sets one) and the gate is marked seen.
function switchToStaff() {
  localStorage.setItem('clinic_gate_seen', '1')
  localStorage.removeItem('clinic_slug')
  clinic.code.value = ''
  clinic.clinicName.value = ''
  side.value = 'staff'
}

function selectSide(next: 'staff' | 'patient') {
  if (next === 'patient') backToJoin()
  else switchToStaff()
}

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signInError) {
    error.value = authErrorMessage(signInError)
    return
  }
  // Blur explicitly and give the keyboard-dismiss animation a beat to finish
  // before the route change -- navigating while it's still mid-resize can
  // leave the new page measuring itself against a WebView frame that hasn't
  // caught up yet, clipping content at the edge.
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/')
}
</script>

<template>
  <OnboardingLayout :trust="false" embedded>
    <template v-if="side === 'patient'" #brand>
      <AuthClinicBrand :name="clinic.clinicName.value || undefined" />
    </template>

    <template #heading>
      <AuthDoorSwitch :current="side" buttons class="mb-7" @select="selectSide" />
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">
        {{ side === 'patient' ? t('Patient sign in', 'Entra como paciente') : t('Sign in', 'Inicia sesión') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">
        {{
          side === 'patient'
            ? t('Your appointments, invoices and documents.', 'Tus citas, facturas y documentos de la clínica.')
            : t('Your day, your patients and their visits.', 'Tu día, tus pacientes y sus visitas.')
        }}
      </p>
    </template>

    <template #form>
      <form class="mt-5 flex flex-col gap-[18px]" @submit.prevent="onSubmit">
        <div
          v-if="side === 'patient' && clinic.clinicName.value"
          class="flex items-center gap-2.5 rounded-card border border-line bg-surface-subtle px-3 py-2.5"
          data-testid="clinic-chip"
        >
          <span
            aria-hidden="true"
            class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ctl bg-brand text-[12.5px] font-bold text-white"
          >{{ clinic.clinicName.value.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px] font-semibold text-ink-900">{{ clinic.clinicName.value }}</p>
            <p class="truncate text-[12px] text-ink-muted">{{ t('Clinic code', 'Código') }}: {{ clinic.code.value }}</p>
          </div>
          <button type="button" class="rounded-ctlSm px-2 py-1 text-[13px] font-medium text-brand-text" @click="backToJoin">
            {{ t('Change', 'Cambiar') }}
          </button>
        </div>

        <OnboardingFormField id="email" :label="t('Email', 'Correo electrónico')">
          <OnboardingTextInput id="email" v-model="email" type="email" autocomplete="username" required :readonly="loading" />
        </OnboardingFormField>

        <OnboardingFormField id="password" :label="t('Password', 'Contraseña')">
          <template #aside>
            <NuxtLink to="/forgot-password" class="text-[13px] font-medium text-brand-text">
              {{ t('Forgot your password?', '¿La has olvidado?') }}
            </NuxtLink>
          </template>
          <OnboardingPasswordInput id="password" v-model="password" mode="current" :readonly="loading" />
        </OnboardingFormField>

        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

        <OnboardingPrimaryButton class="mt-1" :loading="loading" :loading-label="t('Signing in…', 'Entrando…')">
          {{ t('Sign in', 'Entrar') }}
        </OnboardingPrimaryButton>

        <p v-if="side === 'patient'" class="text-center text-[13.5px] text-ink-muted">
          {{ t('First time here?', '¿Primera vez aquí?') }}
          <NuxtLink to="/signup" class="font-semibold text-brand-text">{{ t('Create your account', 'Crea tu cuenta de paciente') }}</NuxtLink>
        </p>
      </form>
    </template>


    <template #preview>
      <AuthPreviewPortal v-if="side === 'patient'" :clinic-name="clinic.clinicName.value || undefined" />
      <OnboardingPreviewCalendar
        v-else
        eyebrow="QuiroFlow"
        :title="t('Your clinic, in one place', 'Tu clínica, en un solo sitio')"
        :body="t('Your day, your patients and their visits, from your phone.', 'Tu día, tus pacientes y sus visitas, desde el móvil.')"
      />
    </template>
  </OnboardingLayout>
</template>
