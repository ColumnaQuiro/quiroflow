<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const publishableKey = ref('')
const secretKey = ref('')
const hasStoredSecretKey = ref(false)
const webhookSecret = ref('')
const hasStoredWebhookSecret = ref(false)

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

const testing = ref(false)
const testResult = ref('')
const testError = ref('')

const webhookUrl = ref('')
onMounted(() => {
  webhookUrl.value = `${window.location.origin}/api/stripe/webhook/${store.accountId}`
})

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select('stripe_publishable_key, stripe_secret_key, stripe_webhook_secret')
    .eq('id', store.accountId!)
    .maybeSingle()
  publishableKey.value = data?.stripe_publishable_key ?? ''
  hasStoredSecretKey.value = !!data?.stripe_secret_key
  hasStoredWebhookSecret.value = !!data?.stripe_webhook_secret
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
</script>

<template>
  <div class="max-w-2xl">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Payments (Stripe)</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      Connect your own Stripe account to charge patients automatically — a saved card per patient, then package
      installments or membership renewals billed on schedule without staff having to do anything.
    </p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <form v-else class="mt-6 space-y-6" @submit.prevent="save">
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
    </form>

    <div class="mt-6 flex items-center gap-3">
      <button type="button" :disabled="testing" class="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50" @click="testConnection">
        {{ testing ? 'Testing…' : 'Test connection' }}
      </button>
      <span v-if="testResult" class="text-xs text-green-600">{{ testResult }}</span>
      <span v-if="testError" class="text-xs text-red-600">{{ testError }}</span>
    </div>

    <div class="mt-8 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">Webhook</h3>
      <p class="mt-1 text-sm text-gray-500">
        Register this URL in your Stripe dashboard under <strong>Developers &rarr; Webhooks</strong>, listening for
        <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">invoice.paid</code>,
        <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">invoice.payment_failed</code>,
        <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.updated</code>,
        <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.released</code>, and
        <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">subscription_schedule.canceled</code>. It's how
        QuiroFlow finds out a scheduled charge went through (or failed) — Stripe does the actual charging on its own.
      </p>
      <div class="mt-1.5 flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-gray-100 px-2 py-1 text-xs">{{ webhookUrl }}</code>
      </div>
      <p class="mt-2 text-xs text-gray-400">
        Copy the "Signing secret" shown after creating the endpoint into the field above.
      </p>
    </div>
  </div>
</template>
