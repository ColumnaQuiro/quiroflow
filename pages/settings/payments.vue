<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()

const connectAccountId = ref<string | null>(null)
const publishableKey = ref('')
const secretKey = ref('')
const hasStoredSecretKey = ref(false)
const webhookSecret = ref('')
const hasStoredWebhookSecret = ref(false)
const showLegacyForm = ref(false)

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

const testing = ref(false)
const testResult = ref('')
const testError = ref('')

const connectError = ref(typeof route.query.stripe_error === 'string' ? route.query.stripe_error : '')
const justConnected = ref(route.query.stripe_connected === '1')

const webhookUrl = ref('')
onMounted(() => {
  webhookUrl.value = `${window.location.origin}/api/stripe/webhook/${store.accountId}`
  // These come from the OAuth redirect's query string -- strip them so a
  // plain page refresh doesn't keep re-showing a stale result forever.
  if (route.query.stripe_error || route.query.stripe_connected) {
    navigateTo({ path: route.path }, { replace: true })
  }
})

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_publishable_key, stripe_secret_key, stripe_webhook_secret')
    .eq('id', store.accountId!)
    .maybeSingle()
  connectAccountId.value = data?.stripe_connect_account_id ?? null
  publishableKey.value = data?.stripe_publishable_key ?? ''
  hasStoredSecretKey.value = !!data?.stripe_secret_key
  hasStoredWebhookSecret.value = !!data?.stripe_webhook_secret
  showLegacyForm.value = !connectAccountId.value && hasStoredSecretKey.value
  loading.value = false
}
onMounted(load)

async function save() {
  error.value = ''
  saved.value = false
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    stripe_publishable_key: publishableKey.value.trim() || null,
  }
  if (secretKey.value.trim()) update.stripe_secret_key = secretKey.value.trim()
  if (webhookSecret.value.trim()) update.stripe_webhook_secret = webhookSecret.value.trim()

  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  saved.value = true
  if (secretKey.value.trim()) hasStoredSecretKey.value = true
  if (webhookSecret.value.trim()) hasStoredWebhookSecret.value = true
  secretKey.value = ''
  webhookSecret.value = ''
}

async function testConnection() {
  testing.value = true
  testResult.value = ''
  testError.value = ''
  try {
    const res = await $fetch<{ livemode: boolean }>('/api/stripe/test-connection', { method: 'POST' })
    testResult.value = res.livemode ? 'Connected — live mode.' : 'Connected — test mode.'
  } catch (err: any) {
    testError.value = err?.data?.statusMessage ?? 'Connection failed'
  } finally {
    testing.value = false
  }
}

async function disconnect() {
  if (!confirm('Disconnect this Stripe account? Existing schedules keep running on Stripe, but QuiroFlow will stop being able to charge new cards until you reconnect.')) return
  await supabase.from('accounts').update({ stripe_connect_account_id: null }).eq('id', store.accountId!)
  connectAccountId.value = null
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 max-w-2xl flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Payments (Stripe)</h1>
    <p class="mt-1 text-sm text-gray-500">
      Connect your own Stripe account to charge patients automatically — a saved card per patient, then package
      installments or membership renewals billed on schedule without staff having to do anything.
    </p>

    <div v-if="justConnected" class="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
      Stripe account connected.
    </div>
    <div v-if="connectError" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ connectError }}
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <template v-else>
      <div v-if="connectAccountId" class="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900">Connected via Stripe Connect</p>
            <p class="mt-0.5 text-xs text-gray-500">Account <code class="rounded bg-gray-100 px-1 py-0.5">{{ connectAccountId }}</code></p>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" :disabled="testing" class="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50" @click="testConnection">
              {{ testing ? 'Testing…' : 'Test connection' }}
            </button>
            <button type="button" class="text-xs font-medium text-red-600 hover:text-red-700" @click="disconnect">Disconnect</button>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-400">
          No webhook setup needed — events are routed to QuiroFlow automatically for every connected clinic.
        </p>
        <p v-if="testResult" class="mt-2 text-xs text-green-600">{{ testResult }}</p>
        <p v-if="testError" class="mt-2 text-xs text-red-600">{{ testError }}</p>
      </div>

      <div v-else class="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p class="text-sm text-gray-600">Connect your Stripe account in one click — no API keys to copy.</p>
        <a
          href="/api/stripe/connect/start"
          class="mt-3 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Connect with Stripe
        </a>
      </div>

      <form v-if="showLegacyForm" class="mt-4 space-y-6 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="save">
        <p class="text-xs text-gray-500">
          Legacy path: paste your own Stripe API keys directly. Prefer "Connect with Stripe" above when possible.
        </p>
        <div>
          <label class="block text-sm font-medium text-gray-700">Publishable key</label>
          <input
            v-model="publishableKey"
            type="text"
            placeholder="pk_test_…"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700">Secret key</label>
          <input
            v-model="secretKey"
            type="password"
            autocomplete="off"
            :placeholder="hasStoredSecretKey ? 'Key is set — leave blank to keep it' : 'sk_test_…'"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700">Webhook signing secret</label>
          <input
            v-model="webhookSecret"
            type="password"
            autocomplete="off"
            :placeholder="hasStoredWebhookSecret ? 'Secret is set — leave blank to keep it' : 'whsec_…'"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p class="mt-1 text-xs text-gray-500">From the Stripe dashboard once you register the webhook URL below.</p>
        </div>

        <div class="flex items-center gap-3">
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <span v-if="saved" class="text-sm text-green-600">Saved.</span>
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 class="text-sm font-semibold text-gray-900">Webhook</h3>
          <p class="mt-1 text-sm text-gray-500">
            Register this URL in your Stripe dashboard under <strong>Developers &rarr; Webhooks</strong>, listening for
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">invoice.paid</code>,
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">invoice.payment_failed</code>,
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.updated</code>,
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.released</code>, and
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.canceled</code>.
          </p>
          <div class="mt-1.5 flex items-center gap-2">
            <code class="flex-1 overflow-x-auto rounded bg-gray-100 px-2 py-1 text-xs">{{ webhookUrl }}</code>
          </div>
        </div>
      </form>

      <p class="mt-10 text-center text-[11px] text-gray-300">
        <button type="button" class="hover:text-gray-500" @click="showLegacyForm = !showLegacyForm">
          {{ showLegacyForm ? 'hide advanced setup' : 'advanced setup' }}
        </button>
      </p>
    </template>
    </div>
  </div>
</template>
