<script setup lang="ts">
const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Once "I'm on the clinic's team" is tapped on /join, clinic_gate_seen is
// set permanently and there was no way back to /join to instead enter a
// patient's clinic code -- clearing both localStorage keys and returning
// there resets the choice entirely, same fresh state as a new install.
function backToJoin() {
  localStorage.removeItem('clinic_gate_seen')
  localStorage.removeItem('clinic_slug')
  navigateTo('/join')
}

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signInError) {
    error.value = signInError.message
    return
  }
  // Blur explicitly and give the keyboard-dismiss animation a beat to finish
  // before the route change -- navigating while it's still mid-resize can
  // leave the new page measuring itself against a WebView frame that hasn't
  // caught up yet, clipping content at the edge.
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/')
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-surface-page px-6">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <img src="/logo/quiroflow-mark.svg" alt="" class="h-8 w-8" />
      <h1 class="mt-4 text-xl font-semibold text-ink-900">Sign in to QuiroFlow</h1>
      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-ink-700" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </UiBtn>
      </form>
      <p class="mt-4 text-center text-sm text-ink-muted">
        New patient?
        <NuxtLink to="/signup" class="font-medium text-brand hover:text-brand-hover">Create an account</NuxtLink>
      </p>
      <button type="button" class="mt-3 block w-full text-center text-sm text-ink-faint hover:text-ink-muted" @click="backToJoin">
        &larr; Not on the team? Enter a clinic code instead
      </button>
    </div>
  </div>
</template>
