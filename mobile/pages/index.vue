<script setup lang="ts">
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient, teamMember, loading } = useIdentity()

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

  <div v-else-if="!patient && !teamMember" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <p class="max-w-xs text-sm text-ink-muted">
      {{ t("This account isn't linked to a patient or team record yet.", 'Esta cuenta todavía no está vinculada a una ficha de paciente o de equipo.') }}
    </p>
    <UiBtn variant="secondary" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</UiBtn>
  </div>

  <PatientHome v-else-if="patient" :patient-id="patient.id" :patient-first-name="patient.first_name" />
</template>
