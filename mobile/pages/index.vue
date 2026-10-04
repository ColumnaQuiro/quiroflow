<script setup lang="ts">
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient, teamMember, twoFactor, loading, reload } = useIdentity()

// The patient tabs belong to a signed-in patient. While identity loads, while
// the authenticator code is still owed, or for an account linked to nothing,
// there is nowhere for those tabs to go -- and with them, the two-factor step
// right after the password looked like the inside of the app with a form on
// top. Those screens get the plain layout, like the sign-in before them.
watchEffect(() => {
  const inside = !loading.value && twoFactor.value === 'ok' && !!(patient.value || teamMember.value)
  setPageLayout(inside ? 'patient' : 'default')
})

// Staff with no patient record of their own have nothing to see here, so
// they go straight to their own tabs. A dual-identity user (rare, but the
// schema allows it -- see useIdentity.ts) lands on the patient side and
// crosses over from Account, rather than the app guessing for them.
watch(
  [patient, teamMember, loading],
  ([p, tm, l]) => {
    if (l) return
    if (tm && !p) navigateTo('/my-day')
  },
  { immediate: true },
)

const supabase = useSupabaseClient()
async function signOut() {
  await supabase.auth.signOut()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/login')
}
</script>

<template>
  <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-ink-faint">
    {{ t('Loading…', 'Cargando…') }}
  </div>

  <!-- Signed in with the password, still owes the authenticator code (or
       their clinic requires two-factor and it isn't set up yet). Nothing
       below can load until then -- the database returns no rows for this
       login -- so this is the whole screen. -->
  <OnboardingLayout v-else-if="twoFactor !== 'ok'" embedded>
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <h1 class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900">
        {{
          twoFactor === 'verify'
            ? t('Two-factor authentication', 'Verificación en dos pasos')
            : t('Set up two-factor authentication', 'Configura la verificación en dos pasos')
        }}
      </h1>
      <p v-if="twoFactor !== 'verify'" class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted">
        {{ t('Your clinic requires a code from an authenticator app every time you sign in. Set it up once to continue.', 'Tu clínica exige un código de una app de autenticación cada vez que inicias sesión. Configúralo una vez para continuar.') }}
      </p>
    </template>

    <template #form>
      <div class="mt-5">
        <AuthTwoFactorCode v-if="twoFactor === 'verify'" @verified="reload" />
        <AuthTwoFactorEnroll v-else required @enabled="reload" />
        <button type="button" class="mt-6 text-[13.5px] font-medium text-ink-muted" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</button>
      </div>
    </template>

    <template #trust>
      <p class="text-[12px] leading-relaxed text-ink-muted">
        {{ t('Patient records stored in the EU under GDPR.', 'Historiales alojados en la UE conforme al RGPD.') }}
      </p>
    </template>
  </OnboardingLayout>

  <div v-else-if="!patient && !teamMember" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <p class="max-w-xs text-sm text-ink-muted">
      {{ t("This account isn't linked to a patient or team record yet.", 'Esta cuenta todavía no está vinculada a una ficha de paciente o de equipo.') }}
    </p>
    <UiBtn variant="secondary" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</UiBtn>
  </div>

  <PatientHome v-else-if="patient" :patient-id="patient.id" :patient-first-name="patient.first_name" />
</template>
