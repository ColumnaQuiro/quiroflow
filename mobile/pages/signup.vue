<script setup lang="ts">
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
    ;(document.activeElement as HTMLElement | null)?.blur()
    await new Promise((resolve) => setTimeout(resolve, 350))
    await navigateTo('/')
    return
  }
  checkEmail.value = true
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-surface-page px-6">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <template v-if="!checkEmail">
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-8 w-8" />
        <h1 class="mt-4 text-xl font-semibold text-ink-900">Create your account</h1>
        <p class="mt-1 text-sm text-ink-muted">Use the same email your clinic has on file for you.</p>
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
              minlength="6"
              autocomplete="new-password"
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
          >. Open it, then come back and sign in.
        </p>
        <NuxtLink to="/login" class="mt-4 block text-center text-sm font-medium text-brand hover:text-brand-hover">Back to sign in</NuxtLink>
      </template>
    </div>
  </div>
</template>
