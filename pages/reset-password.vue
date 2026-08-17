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
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 class="text-xl font-semibold text-gray-900">Set a new password</h1>

      <div v-if="done" class="mt-6 text-sm text-green-600">Password updated. Taking you to your dashboard…</div>

      <div v-else-if="!user" class="mt-6 text-sm text-gray-500">
        This link is invalid or has expired.
        <NuxtLink to="/forgot-password" class="font-medium text-indigo-600 hover:text-indigo-500">Request a new one</NuxtLink>.
      </div>

      <form v-else class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-gray-700" for="password">New password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700" for="confirm">Confirm new password</label>
          <input
            id="confirm"
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ loading ? 'Saving…' : 'Update password' }}
        </button>
      </form>
    </div>
  </div>
</template>
