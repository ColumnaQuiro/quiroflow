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
  await supabase.auth.signOut({ scope: 'local' })
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <!-- The step straight after /login, so the same shell (OnboardingLayout):
       the old centred card was the only screen of the sign-in left on it. -->
  <OnboardingLayout :trust="false">
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <h1 v-if="mode === 'enroll'" class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Set up two-factor authentication', 'Configura la verificación en dos pasos') }}
      </h1>
      <h1 v-else class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Two-factor authentication', 'Verificación en dos pasos') }}
      </h1>
      <p v-if="mode === 'enroll'" class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">
        {{ t('Your clinic requires a code from an authenticator app every time you sign in. Set it up once to continue.', 'Tu clínica exige un código de una app de autenticación cada vez que inicias sesión. Configúralo una vez para continuar.') }}
      </p>
    </template>

    <template #form>
      <div class="mt-5 lg:mt-[26px]">
        <AuthTwoFactorCode v-if="mode === 'verify'" @verified="done" />
        <AuthTwoFactorEnroll v-else-if="mode === 'enroll'" required @enabled="done" />
        <p v-else class="text-sm text-ink-muted">{{ t('Loading…', 'Cargando…') }}</p>
        <button type="button" class="mt-6 text-[13.5px] font-medium text-ink-muted hover:text-ink-700" @click="signOut">
          {{ t('Sign out', 'Cerrar sesión') }}
        </button>
      </div>
    </template>


    <template #preview>
      <OnboardingPreviewCalendar
        eyebrow="QuiroFlow"
        :title="t('Your clinic, in one place', 'Tu clínica, en un solo sitio')"
        :body="t('Calendar, patient records, reminders and invoicing, for every clinic in your practice.', 'Agenda, historiales, recordatorios y facturación, para todas las clínicas de tu consulta.')"
      />
    </template>
  </OnboardingLayout>
</template>
