<script setup lang="ts">
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient, teamMember, twoFactor, loading, reload } = useIdentity()

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
  <div v-else-if="twoFactor !== 'ok'" class="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-10">
    <div class="w-full rounded-card border border-line bg-surface p-6 shadow-card">
      <template v-if="twoFactor === 'verify'">
        <h1 class="text-lg font-semibold text-ink-900">{{ t('Two-factor authentication', 'Verificación en dos pasos') }}</h1>
        <div class="mt-4">
          <AuthTwoFactorCode @verified="reload" />
        </div>
      </template>
      <template v-else>
        <h1 class="text-lg font-semibold text-ink-900">{{ t('Set up two-factor authentication', 'Configura la verificación en dos pasos') }}</h1>
        <p class="mt-1 text-[13px] text-ink-muted">
          {{ t('Your clinic requires a code from an authenticator app every time you sign in. Set it up once to continue.', 'Tu clínica exige un código de una app de autenticación cada vez que inicias sesión. Configúralo una vez para continuar.') }}
        </p>
        <div class="mt-4">
          <AuthTwoFactorEnroll required @enabled="reload" />
        </div>
      </template>
      <button type="button" class="mt-5 text-[12.5px] text-ink-muted" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</button>
    </div>
  </div>

  <div v-else-if="!patient && !teamMember" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <p class="max-w-xs text-sm text-ink-muted">
      {{ t("This account isn't linked to a patient or team record yet.", 'Esta cuenta todavía no está vinculada a una ficha de paciente o de equipo.') }}
    </p>
    <UiBtn variant="secondary" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</UiBtn>
  </div>

  <PatientHome v-else-if="patient" :patient-id="patient.id" :patient-first-name="patient.first_name" />
</template>
