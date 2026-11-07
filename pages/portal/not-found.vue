<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const t = useT()
// ?why=shared: the email is on more than one record at the clinic (a family's).
const route = useRoute()
const shared = computed(() => route.query.why === 'shared')

async function signOut() {
  await supabase.auth.signOut({ scope: 'local' })
  await navigateTo('/portal/login')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
      <template v-if="shared">
        <h1 class="text-lg font-semibold text-ink-900">{{ t('Your clinic needs to link your account', 'Tu clínica tiene que vincular tu cuenta') }}</h1>
        <p class="mt-2 text-sm text-ink-500" data-cy="portal-shared-email">
          {{ t(
            'More than one person at your clinic has this email, so we cannot tell which record is yours. Ask the clinic to link your account. If you look after a family member, ask them to give you access to theirs too.',
            'Este correo lo tienen varias personas en tu clínica, así que no sabemos cuál es tu ficha. Pide en la clínica que vinculen tu cuenta y, si gestionas la de algún familiar, que te den acceso también.',
          ) }}
        </p>
      </template>
      <h1 v-if="!shared" class="text-lg font-semibold text-ink-900">{{ t("We couldn't find your patient record", 'No encontramos tu ficha de paciente') }}</h1>
      <p v-if="!shared" class="mt-2 text-sm text-ink-500" data-cy="portal-record-not-found">
        {{ t(
          "The email on this account doesn't match a patient record at your clinic. Sign out and sign in with the email your clinic has for you, adding your clinic's code. If it still doesn't work, ask the clinic to check the email on your record.",
          'El correo de esta cuenta no coincide con ninguna ficha de tu clínica. Cierra sesión y entra con el correo que tiene tu clínica, añadiendo el código de la clínica. Si sigue sin funcionar, pide en la clínica que revisen el correo de tu ficha.',
        ) }}
      </p>
      <button type="button" class="mt-4 text-sm font-medium text-brand hover:text-brand-hover" @click="signOut">
        {{ t('Sign out', 'Cerrar sesión') }}
      </button>
    </div>
  </div>
</template>
