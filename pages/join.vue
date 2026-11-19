<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const store = useAccountStore()
// Everyone who reads this page is someone a clinic has just invited, before
// they have a team row with a language of their own, so it follows the
// device's language like the rest of sign-up. It was English only, and a
// Spanish clinic's assistant read the refusal below as "it doesn't work".
const t = useT()

// accept_invite's own exceptions are English sentences meant for logs. The
// person here gets them in their language; anything unknown is shown as is.
function acceptErrorMessage(error: { code?: string; message: string }) {
  // PT402 is the seat trigger (enforce_practitioner_seats). Its own message
  // is written for the owner -- "add a seat on the Subscription page" --
  // and the person reading this page is the one being invited, who has no
  // Subscription page. The token is kept, so opening this page again once
  // the owner has made room joins them.
  if (error.code === 'PT402') {
    return t(
      "This practice's plan has no free practitioner seat, so the invite can't be accepted yet. Ask the person who invited you to add a seat, or to invite you as front desk instead — then open your invite link again.",
      'El plan de la consulta no tiene ninguna plaza de profesional libre, así que todavía no puedes aceptar la invitación. Pide a quien te invitó que añada una plaza, o que te invite sin «Atenderá pacientes» (por ejemplo, como recepción), y vuelve a abrir el enlace.',
    )
  }
  if (/already-used invite/i.test(error.message)) {
    return t(
      'This invite link is no longer valid: it was already used, or the invite was replaced by a newer one. Open the link in the most recent invite email, or ask for a new one.',
      'Este enlace de invitación ya no es válido: ya se usó, o la invitación se sustituyó por otra más reciente. Abre el enlace del último email de invitación, o pide uno nuevo.',
    )
  }
  if (/already belong to a practice/i.test(error.message)) {
    return t('You already belong to a practice.', 'Ya formas parte de una consulta.')
  }
  return error.message
}

const state = ref<'checking' | 'need-auth' | 'accepting' | 'linking' | 'error' | 'already-member'>('checking')
const linkedSoFar = ref(0)
const linkRemaining = ref(0)
const errorMessage = ref('')

async function tryAccept(token: string) {
  state.value = 'accepting'
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) {
    state.value = 'error'
    errorMessage.value = acceptErrorMessage(error)
    return
  }
  localStorage.removeItem('pending_invite_token')
  // An invite tied to an imported name brings that name's appointments, and
  // accept_invite only took the first batch of them. The rest are linked here,
  // in batches, before the calendar is opened; with none to link this is one
  // quick call. A failure does not hold them up: they have joined, and what is
  // left shows under Settings -> Team -> imported names.
  state.value = 'linking'
  const linkError = await linkInvitedAppointments(supabase, (step) => {
    linkedSoFar.value = step.linked
    linkRemaining.value = step.remaining
  })
  if (linkError) console.error('Linking invited appointments:', linkError)
  store.reset()
  await store.load()
  await navigateTo('/dashboard')
}

async function startOwnPractice() {
  localStorage.removeItem('pending_invite_token')
  // ?own: they have just turned this invite down, so onboarding does not
  // offer it straight back (it looks open invites up by email).
  await navigateTo('/onboarding?own=1')
}

onMounted(async () => {
  const queryToken = route.query.token as string | undefined
  if (queryToken) localStorage.setItem('pending_invite_token', queryToken)
  const token = localStorage.getItem('pending_invite_token')

  if (!token) {
    state.value = 'error'
    errorMessage.value = t('This invite link is missing its token.', 'A este enlace de invitación le falta el código.')
    return
  }

  if (!store.loaded) await store.load()
  if (store.teamMember) {
    state.value = 'already-member'
    return
  }

  if (user.value) {
    await tryAccept(token)
  } else {
    state.value = 'need-auth'
  }
})

watch(user, async (value) => {
  if (value && state.value === 'need-auth') {
    const token = localStorage.getItem('pending_invite_token')
    if (token) await tryAccept(token)
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
      <template v-if="state === 'checking' || state === 'accepting'">
        <p class="text-sm text-ink-500">{{ state === 'accepting' ? t('Joining the practice…', 'Uniéndote a la consulta…') : t('Checking your invite…', 'Comprobando tu invitación…') }}</p>
      </template>

      <template v-else-if="state === 'linking'">
        <p class="text-sm text-ink-500">{{ t('Bringing over your imported appointments…', 'Trayendo tus citas importadas…') }}</p>
        <p v-if="linkRemaining > 0" class="mt-2 font-mono text-[13px] text-ink-700" data-cy="join-link-progress">
          {{ linkedSoFar }} / {{ linkedSoFar + linkRemaining }}
        </p>
      </template>

      <template v-else-if="state === 'need-auth'">
        <h1 class="text-lg font-semibold text-ink-900">{{ t("You've been invited to QuiroFlow", 'Te han invitado a QuiroFlow') }}</h1>
        <p class="mt-2 text-sm text-ink-500">{{ t('Sign in or create an account to join. Already have one with this email? Sign in.', 'Inicia sesión o crea una cuenta para unirte. ¿Ya tienes una con este email? Inicia sesión.') }}</p>
        <div class="mt-4 flex flex-col gap-2">
          <NuxtLink to="/login" class="rounded-ctl bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
            {{ t('Sign in', 'Iniciar sesión') }}
          </NuxtLink>
          <NuxtLink to="/signup" class="rounded-ctl border border-line-control px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle">
            {{ t('Create an account', 'Crear una cuenta') }}
          </NuxtLink>
        </div>
      </template>

      <template v-else-if="state === 'already-member'">
        <p class="text-sm text-ink-500">{{ t("You're already part of a practice.", 'Ya formas parte de una consulta.') }}</p>
        <NuxtLink to="/dashboard" class="mt-4 inline-block text-sm font-medium text-brand hover:text-brand-hover">
          {{ t('Go to dashboard', 'Ir al panel') }}
        </NuxtLink>
      </template>

      <template v-else>
        <p class="text-sm text-danger-text">{{ errorMessage }}</p>
        <!-- The way out. Someone can reach this page from the sign-up
             middleware with an invite that will never work (used, revoked),
             and before this there was no path from it to anything else. -->
        <button
          v-if="user"
          type="button"
          class="mt-4 text-sm font-medium text-brand hover:text-brand-hover"
          data-test="join-start-own-practice"
          @click="startOwnPractice"
        >
          {{ t('Set up my own practice instead', 'Prefiero crear mi propia consulta') }}
        </button>
      </template>
    </div>
  </div>
</template>
