<script setup lang="ts">
// Everything that isn't the patient's care: who they're signed in as, and
// the two ways out of the app.
//
// Sign out and Delete account used to sit in the home screen's top bar --
// one of them irreversible, both one tap from a patient trying to read
// their next appointment. Account deletion stays in the app (the app
// stores require an in-app route to it) but it belongs here, behind a
// deliberate step, not on the screen the app opens on.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { settings } = usePatientAppInfo()
const { patient, teamMember } = useIdentity()

const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))
const initials = computed(() =>
  [patient.value?.first_name?.[0], patient.value?.last_name?.[0]].filter(Boolean).join('').toUpperCase(),
)

async function signOut() {
  await supabase.auth.signOut()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/login')
}

const deletingAccount = ref(false)
async function deleteAccount() {
  if (
    !confirm(
      t(
        "Delete your account? This removes your login immediately and can't be undone by you.",
        '¿Eliminar tu cuenta? Esto borra tu acceso de inmediato y no podrás deshacerlo.',
      ),
    )
  )
    return
  deletingAccount.value = true
  try {
    await authedFetch('/api/account/delete', { method: 'POST' })
  } catch (err: unknown) {
    deletingAccount.value = false
    alert((err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Failed to delete account.', 'No se pudo eliminar la cuenta.'))
    return
  }
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <PatientScreen :title="t('Account', 'Cuenta')">
    <PatientCard>
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[14px] font-semibold text-ink-600">
          {{ initials || '·' }}
        </span>
        <div class="min-w-0">
          <p class="truncate text-[14px] font-medium text-ink-900">{{ fullName || t('Patient', 'Paciente') }}</p>
          <p v-if="settings.clinicName" class="truncate text-[12.5px] text-ink-muted">{{ settings.clinicName }}</p>
        </div>
      </div>
    </PatientCard>

    <!-- A user who is also staff gets a way across; see
         mobile/pages/index.vue for why both identities are possible. -->
    <NuxtLink
      v-if="teamMember"
      to="/my-day"
      class="mt-3 flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3.5 shadow-card"
    >
      <span class="text-[13.5px] font-medium text-ink-900">{{ t('Switch to practitioner view', 'Cambiar a vista de profesional') }}</span>
      <span class="text-[13px] text-ink-faint">&rarr;</span>
    </NuxtLink>

    <div class="mt-5 space-y-2">
      <UiBtn variant="secondary" class="w-full" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</UiBtn>
      <button
        type="button"
        class="w-full py-2.5 text-center text-[13px] text-danger-text disabled:opacity-50"
        :disabled="deletingAccount"
        @click="deleteAccount"
      >
        {{ deletingAccount ? t('Deleting…', 'Eliminando…') : t('Delete account', 'Eliminar cuenta') }}
      </button>
    </div>
  </PatientScreen>
</template>
