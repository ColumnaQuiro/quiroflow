<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const store = useAccountStore()
const { preference: themePreference, setPreference: setThemePreference } = useTheme()
const { preference: langPreference, setPreference: setLangPreference } = useLang()

const ownerName = ref('')
const accountName = ref('')
const clinicName = ref('')
const error = ref('')
const loading = ref(false)
// 'form' -> 'preferences' -> 'launch': a couple of quick preference picks
// and a brief "you're all set" moment instead of dropping straight into the
// dashboard the instant the account exists -- matches signup.vue's step 1,
// this page covering steps 2-4 of the same flow.
const step = ref<'form' | 'preferences' | 'launch'>('form')

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
  step.value = 'preferences'
}

// Same read-then-write pattern as pages/account.vue's Appearance section --
// applies instantly (useTheme/useLang) and persists to the row store.load()
// just populated.
async function chooseTheme(value: 'light' | 'dark' | 'system') {
  setThemePreference(value)
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', store.teamMember!.id)
}
async function chooseLanguage(value: 'en' | 'es') {
  setLangPreference(value)
  await supabase.from('team_members').update({ language_preference: value }).eq('id', store.teamMember!.id)
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
      <template v-if="step === 'form'">
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Preferences', 'Launch']" :current="2" class="mb-6" />
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
      <template v-else-if="step === 'preferences'">
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Preferences', 'Launch']" :current="3" class="mb-6" />
        <h1 class="text-xl font-semibold text-ink-900">Make it yours</h1>
        <p class="mt-1 text-sm text-ink-muted">You can always change these later from Account.</p>
        <div class="mt-6 space-y-4">
          <div>
            <p class="text-sm font-medium text-ink-700">Appearance</p>
            <div class="mt-1.5 grid grid-cols-3 gap-2">
              <button
                v-for="opt in ['light', 'dark', 'system'] as const"
                :key="opt"
                type="button"
                class="rounded-ctl border px-3 py-2 text-sm capitalize"
                :class="themePreference === opt ? 'border-brand bg-brand-tint text-brand' : 'border-line text-ink-700 hover:bg-surface-subtle'"
                @click="chooseTheme(opt)"
              >
                {{ opt }}
              </button>
            </div>
          </div>
          <div>
            <p class="text-sm font-medium text-ink-700">Language</p>
            <div class="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="rounded-ctl border px-3 py-2 text-sm"
                :class="langPreference === 'en' ? 'border-brand bg-brand-tint text-brand' : 'border-line text-ink-700 hover:bg-surface-subtle'"
                @click="chooseLanguage('en')"
              >
                English
              </button>
              <button
                type="button"
                class="rounded-ctl border px-3 py-2 text-sm"
                :class="langPreference === 'es' ? 'border-brand bg-brand-tint text-brand' : 'border-line text-ink-700 hover:bg-surface-subtle'"
                @click="chooseLanguage('es')"
              >
                Español
              </button>
            </div>
          </div>
        </div>
        <UiBtn variant="primary" class="mt-6 w-full" @click="step = 'launch'">Continue</UiBtn>
      </template>
      <template v-else>
        <OnboardingStepProgress :steps="['Create account', 'Practice setup', 'Preferences', 'Launch']" :current="4" class="mb-6" />
        <h1 class="text-xl font-semibold text-ink-900">You're all set</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ accountName }} is ready. A quick look at what's here:</p>
        <ul class="mt-4 space-y-3 text-sm text-ink-700">
          <li>
            <p class="font-medium text-ink-900">Calendar &amp; online booking</p>
            <p class="text-ink-muted">Manage your schedule and let patients book themselves from a page at your own booking link.</p>
          </li>
          <li>
            <p class="font-medium text-ink-900">WhatsApp &amp; email reminders</p>
            <p class="text-ink-muted">Automatic appointment confirmations and reminders, configurable from Settings.</p>
          </li>
          <li>
            <p class="font-medium text-ink-900">Invoicing &amp; payments</p>
            <p class="text-ink-muted">Connect Stripe from Settings &gt; Payments to charge patients and send invoices.</p>
          </li>
          <li>
            <p class="font-medium text-ink-900">Need a hand?</p>
            <p class="text-ink-muted">Reach us any time at <a href="mailto:hola@columnaquiro.com" class="text-brand hover:text-brand-hover">hola@columnaquiro.com</a>.</p>
          </li>
        </ul>
        <UiBtn variant="primary" class="mt-6 w-full" @click="navigateTo('/dashboard')">Get started</UiBtn>
      </template>
    </div>
  </div>
</template>
