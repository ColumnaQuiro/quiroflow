<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const email = ref('')
const error = ref('')
const loading = ref(false)
const sent = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  loading.value = false
  if (resetError) {
    error.value = resetError.message
    return
  }
  sent.value = true
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <h1 class="text-xl font-semibold text-ink-900">Reset your password</h1>

      <div v-if="sent" class="mt-6">
        <p class="text-sm text-ink-500">
          If an account exists for <strong>{{ email }}</strong>, we've sent a link to reset your password. Check your
          inbox.
        </p>
        <NuxtLink to="/login" class="mt-4 block text-center text-sm font-medium text-brand hover:text-brand-hover">
          &larr; Back to sign in
        </NuxtLink>
      </div>

      <form v-else class="mt-6 space-y-4" @submit.prevent="onSubmit">
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
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </UiBtn>
        <NuxtLink to="/login" class="block text-center text-sm text-ink-muted hover:text-ink-500">&larr; Back to sign in</NuxtLink>
      </form>
    </div>
  </div>
</template>
