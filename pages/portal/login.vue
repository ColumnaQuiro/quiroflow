<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

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
  await navigateTo('/portal')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <h1 class="text-xl font-semibold text-ink-900">Patient sign in</h1>
      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-ink-700" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
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
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </UiBtn>
      </form>
      <p class="mt-4 text-center text-sm text-ink-muted">
        First time here?
        <NuxtLink to="/portal/signup" class="font-medium text-brand hover:text-brand-hover">Create an account</NuxtLink>
      </p>
    </div>
  </div>
</template>
