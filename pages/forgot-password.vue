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
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 class="text-xl font-semibold text-gray-900">Reset your password</h1>

      <div v-if="sent" class="mt-6">
        <p class="text-sm text-gray-600">
          If an account exists for <strong>{{ email }}</strong>, we've sent a link to reset your password. Check your
          inbox.
        </p>
        <NuxtLink to="/login" class="mt-4 block text-center text-sm font-medium text-indigo-600 hover:text-indigo-500">
          &larr; Back to sign in
        </NuxtLink>
      </div>

      <form v-else class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="block text-sm font-medium text-gray-700" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </button>
        <NuxtLink to="/login" class="block text-center text-sm text-gray-500 hover:text-gray-700">&larr; Back to sign in</NuxtLink>
      </form>
    </div>
  </div>
</template>
