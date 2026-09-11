<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const { code, clinicName, prefill, resolve, remember } = useClinicCode()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

onMounted(prefill)

// Resolving on blur turns a typo into an obvious one: the clinic's name
// appears under the field when the code is right, and doesn't when it
// isn't. Quiet on failure -- the patient is still typing their email and
// an error the moment focus leaves the first field reads as an accusation.
async function onCodeBlur() {
  clinicName.value = ''
  if (!code.value.trim()) return
  try {
    await resolve()
  } catch {
    /* reported on submit instead */
  }
}

async function onSubmit() {
  error.value = ''
  loading.value = true
  // The code has to be settled before the password goes anywhere: it's
  // what tells claim_patient_profile() which clinic's record to link for a
  // patient signing in for the first time (middleware/portal.global.ts).
  let slug: string
  try {
    slug = await resolve()
  } catch {
    loading.value = false
    error.value = "Clinic code not found -- check the code your clinic gave you."
    return
  }
  remember(slug)
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
          <label class="block text-sm font-medium text-ink-700" for="clinic-code">Clinic code</label>
          <input
            id="clinic-code"
            v-model="code"
            type="text"
            required
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            autocomplete="organization"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @blur="onCodeBlur"
          />
          <p v-if="clinicName" class="mt-1 text-sm text-ink-muted">{{ clinicName }}</p>
          <p v-else class="mt-1 text-sm text-ink-faint">The code your clinic gave you.</p>
        </div>
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
        <!-- The reset pages existed but nothing on the portal linked to them,
        so a patient who forgot their password had no way forward from here.
        ?portal=1 is what sends them back to this screen afterwards rather
        than to the staff sign-in. -->
        <NuxtLink
          to="/forgot-password?portal=1"
          class="block text-center text-sm text-ink-muted hover:text-ink-500"
        >
          Forgot your password?
        </NuxtLink>
      </form>
      <p class="mt-4 text-center text-sm text-ink-muted">
        First time here?
        <NuxtLink to="/portal/signup" class="font-medium text-brand hover:text-brand-hover">Create an account</NuxtLink>
      </p>
    </div>
  </div>
</template>
