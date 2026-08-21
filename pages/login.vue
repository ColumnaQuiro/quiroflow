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
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
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
        <div class="flex items-center justify-between">
          <UiBtn type="submit" variant="primary" :disabled="loading">
            {{ loading ? 'Signing in…' : 'Sign in' }}
          </UiBtn>
          <NuxtLink to="/forgot-password" class="text-sm text-ink-muted hover:text-ink-500">Forgot password?</NuxtLink>
        </div>
      </form>
      <p class="mt-4 text-center text-sm text-ink-muted">
        No account yet?
        <NuxtLink to="/signup" class="font-medium text-brand hover:text-brand-hover">Create one</NuxtLink>
      </p>
    </div>
  </div>
</template>
