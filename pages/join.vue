<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const store = useAccountStore()

const state = ref<'checking' | 'need-auth' | 'accepting' | 'error' | 'already-member'>('checking')
const errorMessage = ref('')

async function tryAccept(token: string) {
  state.value = 'accepting'
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) {
    state.value = 'error'
    // PT402 is the seat trigger (enforce_practitioner_seats). Its own message
    // is written for the owner -- "add a seat on the Subscription page" --
    // and the person reading this page is the one being invited, who has no
    // Subscription page. The token is kept, so opening this page again once
    // the owner has made room joins them.
    errorMessage.value =
      error.code === 'PT402'
        ? "This practice's plan has no free practitioner seat, so the invite can't be accepted yet. Ask the person who invited you to add a seat, or to invite you as front desk instead — then open your invite link again."
        : error.message
    return
  }
  localStorage.removeItem('pending_invite_token')
  store.reset()
  await store.load()
  await navigateTo('/dashboard')
}

async function startOwnPractice() {
  localStorage.removeItem('pending_invite_token')
  await navigateTo('/onboarding')
}

onMounted(async () => {
  const queryToken = route.query.token as string | undefined
  if (queryToken) localStorage.setItem('pending_invite_token', queryToken)
  const token = localStorage.getItem('pending_invite_token')

  if (!token) {
    state.value = 'error'
    errorMessage.value = 'This invite link is missing its token.'
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
        <p class="text-sm text-ink-500">{{ state === 'accepting' ? 'Joining the practice…' : 'Checking your invite…' }}</p>
      </template>

      <template v-else-if="state === 'need-auth'">
        <h1 class="text-lg font-semibold text-ink-900">You've been invited to QuiroFlow</h1>
        <p class="mt-2 text-sm text-ink-500">Sign in or create an account to join.</p>
        <div class="mt-4 flex flex-col gap-2">
          <NuxtLink to="/login" class="rounded-ctl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
            Sign in
          </NuxtLink>
          <NuxtLink to="/signup" class="rounded-ctl border border-line-control px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle">
            Create an account
          </NuxtLink>
        </div>
      </template>

      <template v-else-if="state === 'already-member'">
        <p class="text-sm text-ink-500">You're already part of a practice.</p>
        <NuxtLink to="/dashboard" class="mt-4 inline-block text-sm font-medium text-brand hover:text-brand-hover">
          Go to dashboard
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
          Set up my own practice instead
        </button>
      </template>
    </div>
  </div>
</template>
