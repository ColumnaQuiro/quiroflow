<script setup lang="ts">
import type { TwoFactorGate } from '../composables/useTwoFactor'

// Where middleware/account.global.ts sends a signed-in session that has not
// satisfied two-factor yet -- straight after the password on /login, or on
// any later visit with a password-only session. Two cases:
//   verify -- they have an authenticator set up: ask for the code.
//   enroll -- their clinic requires it and they have none: set one up now.
definePageMeta({ layout: false })

const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { gate } = useTwoFactor()
const t = useT()

const mode = ref<TwoFactorGate | null>(null)

// Only a same-app path, never a full URL someone put in a link.
function nextPath() {
  const next = typeof route.query.next === 'string' ? route.query.next : ''
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/two-factor') ? next : '/dashboard'
}

onMounted(async () => {
  mode.value = await gate()
  if (mode.value === 'ok') await navigateTo(nextPath(), { replace: true })
})

async function done() {
  // The account store may already have loaded (and come back empty) under
  // the password-only session; load it again under the verified one.
  store.reset()
  await navigateTo(nextPath(), { replace: true })
}

async function signOut() {
  await supabase.auth.signOut()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4 py-10">
    <div class="w-full rounded-card border border-line bg-surface p-8 shadow-card" :class="mode === 'enroll' ? 'max-w-lg' : 'max-w-sm'">
      <img src="/logo/quiroflow-mark.svg" alt="" class="h-8 w-8" />

      <template v-if="mode === 'verify'">
        <h1 class="mt-4 text-xl font-semibold text-ink-900">{{ t('Two-factor authentication', 'Verificación en dos pasos') }}</h1>
        <div class="mt-6">
          <AuthTwoFactorCode @verified="done" />
        </div>
      </template>

      <template v-else-if="mode === 'enroll'">
        <h1 class="mt-4 text-xl font-semibold text-ink-900">{{ t('Set up two-factor authentication', 'Configura la verificación en dos pasos') }}</h1>
        <p class="mt-1 text-[13px] text-ink-muted">
          {{ t('Your clinic requires a code from an authenticator app every time you sign in. Set it up once to continue.', 'Tu clínica exige un código de una app de autenticación cada vez que inicias sesión. Configúralo una vez para continuar.') }}
        </p>
        <div class="mt-6">
          <AuthTwoFactorEnroll required @enabled="done" />
        </div>
      </template>

      <p v-else class="mt-4 text-sm text-ink-muted">{{ t('Loading…', 'Cargando…') }}</p>

      <button type="button" class="mt-6 text-[12.5px] text-ink-muted hover:text-ink-500" @click="signOut">
        {{ t('Sign out', 'Cerrar sesión') }}
      </button>
    </div>
  </div>
</template>
