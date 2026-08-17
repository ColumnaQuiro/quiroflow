<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const checkEmail = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (signUpError) {
    error.value = signUpError.message
    return
  }
  if (data.session) {
    // Email confirmation is disabled on this project — session is live already.
    await navigateTo('/onboarding')
    return
  }
  checkEmail.value = true
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <template v-if="!checkEmail">
        <h1 class="text-xl font-semibold text-gray-900">Create your practice's QuiroFlow account</h1>
        <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
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
          <div>
            <label class="block text-sm font-medium text-gray-700" for="password">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              minlength="6"
              class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
          <button
            type="submit"
            :disabled="loading"
            class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {{ loading ? 'Creating account…' : 'Create account' }}
          </button>
        </form>
        <p class="mt-4 text-center text-sm text-gray-500">
          Already have an account?
          <NuxtLink to="/login" class="font-medium text-indigo-600 hover:text-indigo-500">Sign in</NuxtLink>
        </p>
      </template>
      <template v-else>
        <h1 class="text-xl font-semibold text-gray-900">Check your email</h1>
        <p class="mt-2 text-sm text-gray-600">
          We sent a confirmation link to <strong>{{ email }}</strong
          >. Click it to finish setting up your account.
        </p>
      </template>
    </div>
  </div>
</template>
