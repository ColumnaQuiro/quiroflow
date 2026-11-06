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
            'More than one person at your clinic has this email, so we cannot tell which record is yours. Ask the clinic to link your account -- and, if you look after a family member, to give you access to theirs too.',
            'Este correo lo tienen varias personas en tu clínica, así que no sabemos cuál es tu ficha. Pide en la clínica que vinculen tu cuenta y, si gestionas la de algún familiar, que te den acceso también.',
          ) }}
        </p>
      </template>
      <h1 v-if="!shared" class="text-lg font-semibold text-ink-900">We couldn't find your record</h1>
      <p v-if="!shared" class="mt-2 text-sm text-ink-500">
        Your account email doesn't match a patient record at the clinic whose code you entered. Check that both the
        code and the email are the ones your clinic has for you, or contact them to be added, then try again.
      </p>
      <button type="button" class="mt-4 text-sm font-medium text-brand hover:text-brand-hover" @click="signOut">
        Sign out
      </button>
    </div>
  </div>
</template>
