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
  localStorage.setItem('signup_intent', 'staff')
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
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <template v-if="!checkEmail">
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Launch']" :current="1" class="mb-6" />
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-8 w-8" />
        <h1 class="mt-4 text-xl font-semibold text-ink-900">Create your practice's QuiroFlow account</h1>
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
              minlength="6"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
          <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
            {{ loading ? 'Creating account…' : 'Create account' }}
          </UiBtn>
        </form>
        <p class="mt-4 text-center text-sm text-ink-muted">
          Already have an account?
          <NuxtLink to="/login" class="font-medium text-brand hover:text-brand-hover">Sign in</NuxtLink>
        </p>
      </template>
      <template v-else>
        <h1 class="text-xl font-semibold text-ink-900">Check your email</h1>
        <p class="mt-2 text-sm text-ink-500">
          We sent a confirmation link to <strong>{{ email }}</strong
          >. Click it to finish setting up your account.
        </p>
      </template>
    </div>
  </div>
</template>
