<script setup lang="ts">
const supabase = useSupabaseClient()
const t = useT()
const authErrorMessage = useAuthErrorMessage()
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
    error.value = authErrorMessage(signUpError)
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
        <h1 class="mt-4 text-xl font-semibold text-ink-900">{{ t('Create your account', 'Crea tu cuenta') }}</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ t('Use the same email your clinic has on file for you.', 'Usa el mismo correo que tiene tu clínica en tu ficha.') }}</p>
        <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
          <div>
            <label class="block text-sm font-medium text-ink-700" for="email">{{ t('Email', 'Correo electrónico') }}</label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              autocomplete="username"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="password">{{ t('Password', 'Contraseña') }}</label>
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
            {{ loading ? t('Creating account…', 'Creando cuenta…') : t('Create account', 'Crear cuenta') }}
          </UiBtn>
        </form>
        <p class="mt-4 text-center text-sm text-ink-muted">
          {{ t('Already have an account?', '¿Ya tienes cuenta?') }}
          <NuxtLink to="/login" class="font-medium text-brand hover:text-brand-hover">{{ t('Sign in', 'Inicia sesión') }}</NuxtLink>
        </p>
      </template>
      <template v-else>
        <h1 class="text-xl font-semibold text-ink-900">{{ t('Check your email', 'Revisa tu correo') }}</h1>
        <p class="mt-2 text-sm text-ink-500">
          {{ t('We sent a confirmation link to', 'Te hemos enviado un enlace de confirmación a') }} <strong>{{ email }}</strong
          >. {{ t('Open it, then come back and sign in.', 'Ábrelo y vuelve para iniciar sesión.') }}
        </p>
        <NuxtLink to="/login" class="mt-4 block text-center text-sm font-medium text-brand hover:text-brand-hover">{{ t('Back to sign in', 'Volver a iniciar sesión') }}</NuxtLink>
      </template>
    </div>
  </div>
</template>
