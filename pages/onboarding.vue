<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const store = useAccountStore()

const ownerName = ref('')
const accountName = ref('')
const clinicName = ref('')
const error = ref('')
const loading = ref(false)
// 'form' -> 'launch': a brief "you're all set" moment instead of dropping
// straight into the dashboard the instant the account exists -- matches
// signup.vue's step 1, this page covering steps 2-3 of the same flow.
const step = ref<'form' | 'launch'>('form')

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: rpcError } = await supabase.rpc('create_account_with_owner', {
    p_account_name: accountName.value,
    p_clinic_name: clinicName.value,
    p_owner_name: ownerName.value,
  })
  loading.value = false
  if (rpcError) {
    error.value = rpcError.message
    return
  }
  store.reset()
  await store.load()
  // Best-effort -- if this fails (e.g. Netlify not configured), the clinic
  // still works fine, its booking subdomain just needs adding manually.
  try {
    await useStaffFetch('/api/internal/register-clinic-subdomain', { method: 'POST' })
  } catch {
    // ignore
  }
  step.value = 'launch'
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <template v-if="step === 'form'">
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Launch']" :current="2" class="mb-6" />
        <h1 class="text-xl font-semibold text-ink-900">Set up your practice</h1>
        <p class="mt-1 text-sm text-ink-muted">This creates your account and first clinic location.</p>
        <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
          <div>
            <label class="block text-sm font-medium text-ink-700" for="owner-name">Your name</label>
            <input
              id="owner-name"
              v-model="ownerName"
              type="text"
              required
              placeholder="Lea Guido"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="account-name">Practice name</label>
            <input
              id="account-name"
              v-model="accountName"
              type="text"
              required
              placeholder="ColumnaQuiro"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="clinic-name">First clinic location</label>
            <input
              id="clinic-name"
              v-model="clinicName"
              type="text"
              required
              placeholder="Valencia"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
          <UiBtn type="submit" variant="primary" class="w-full" :disabled="loading">
            {{ loading ? 'Setting up…' : 'Create practice' }}
          </UiBtn>
        </form>
      </template>
      <template v-else>
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Launch']" :current="3" class="mb-6" />
        <h1 class="text-xl font-semibold text-ink-900">You're all set</h1>
        <p class="mt-1 text-sm text-ink-muted">
          {{ accountName }} is ready. Your calendar, patients, and settings are all waiting -- explore, or head to Settings to fine-tune things like appointment types and online booking.
        </p>
        <UiBtn variant="primary" class="mt-6 w-full" @click="navigateTo('/dashboard')">Get started</UiBtn>
      </template>
    </div>
  </div>
</template>
