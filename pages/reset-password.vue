<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const done = ref(false)

async function onSubmit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  const { error: updateError } = await supabase.auth.updateUser({ password: password.value })
  loading.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  done.value = true
  setTimeout(() => navigateTo('/dashboard'), 1500)
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <h1 class="text-xl font-semibold text-ink-900">Set a new password</h1>

      <div v-if="done" class="mt-6 text-sm text-success-text">Password updated. Taking you to your dashboard…</div>

      <div v-else-if="!user" class="mt-6 text-sm text-ink-muted">
        This link is invalid or has expired.
        <NuxtLink to="/forgot-password" class="font-medium text-brand hover:text-brand-hover">Request a new one</NuxtLink>.
      </div>

      <form v-else class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-ink-700" for="password">New password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700" for="confirm">Confirm new password</label>
          <input
            id="confirm"
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
          {{ loading ? 'Saving…' : 'Update password' }}
        </UiBtn>
      </form>
    </div>
  </div>
</template>
