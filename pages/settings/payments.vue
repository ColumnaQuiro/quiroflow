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
    const res = await useStaffFetch<{ livemode: boolean }>('/api/stripe/test-connection', { method: 'POST' })
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
  <div class="flex h-full flex-col">
    <PageHeader title="Payments (Stripe)">
      <UiBtn v-if="showLegacyForm" variant="primary" :disabled="saving || loading" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            Automate installments and renewals with a saved card. Connect your own Stripe account to charge patients
            automatically — package installments or membership renewals billed on schedule without staff having to
            do anything.
          </p>

          <div v-if="justConnected" class="mt-4 rounded-ctl border border-success-border bg-success-bg p-3 text-[12.5px] text-success-deep">
            Stripe account connected.
          </div>
          <div v-if="connectError" class="mt-4 rounded-ctl border border-danger-border bg-danger-bg p-3 text-[12.5px] text-danger-text">
            {{ connectError }}
          </div>

          <div v-if="loading" class="mt-6 text-[13px] text-ink-faint">Loading…</div>
          <template v-else>
            <div v-if="connectAccountId" class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">Connected via Stripe Connect</p>
                  <p class="mt-0.5 text-[12.5px] text-ink-muted2">Account <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">{{ connectAccountId }}</code></p>
                </div>
                <div class="flex items-center gap-3">
                  <button type="button" :disabled="testing" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-50" @click="testConnection">
                    {{ testing ? 'Testing…' : 'Test connection' }}
                  </button>
                  <button type="button" class="text-[12.5px] font-medium text-danger-text hover:text-danger-text/80" @click="disconnect">Disconnect</button>
                </div>
              </div>
              <p class="mt-2 text-[12px] text-ink-faint">
                No webhook setup needed — events are routed to QuiroFlow automatically for every connected clinic.
              </p>
              <p v-if="testResult" class="mt-2 text-[12.5px] text-success-text">{{ testResult }}</p>
              <p v-if="testError" class="mt-2 text-[12.5px] text-danger-text">{{ testError }}</p>
            </div>

            <div v-else class="mt-6 rounded-card border border-line bg-surface p-6 text-center shadow-card">
              <p class="text-[13px] text-ink-600">Connect your Stripe account in one click — no API keys to copy.</p>
              <a
                href="/api/stripe/connect/start"
                class="mt-3 inline-flex h-8 items-center gap-2 rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover"
              >
                Connect with Stripe
              </a>
            </div>

            <form v-if="showLegacyForm" class="mt-4 space-y-3" @submit.prevent="save">
              <p class="text-[12.5px] text-ink-muted2">
                Legacy path: paste your own Stripe API keys directly. Prefer "Connect with Stripe" above when possible.
              </p>
              <SettingsFieldRow label="Publishable key">
                <input
                  v-model="publishableKey"
                  type="text"
                  placeholder="pk_test_…"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <SettingsFieldRow label="Secret key" :helper="hasStoredSecretKey ? 'A key is already stored — leave blank to keep it.' : undefined">
                <input
                  v-model="secretKey"
                  type="password"
                  autocomplete="off"
                  :placeholder="hasStoredSecretKey ? 'Leave blank to keep it' : 'sk_test_…'"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <SettingsFieldRow
                label="Webhook signing secret"
                :helper="hasStoredWebhookSecret ? 'A secret is already stored — leave blank to keep it.' : 'From the Stripe dashboard once you register the webhook URL below.'"
              >
                <input
                  v-model="webhookSecret"
                  type="password"
                  autocomplete="off"
                  :placeholder="hasStoredWebhookSecret ? 'Leave blank to keep it' : 'whsec_…'"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <p v-if="saved" class="text-[12.5px] text-success-text">Saved.</p>
              <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>

              <div class="rounded-card border border-line bg-surface-subtle p-4">
                <h3 class="text-[13.5px] font-[560] text-ink-700">Webhook</h3>
                <p class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2">
                  Register this URL in your Stripe dashboard under <strong>Developers &rarr; Webhooks</strong>, listening for
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">invoice.paid</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">invoice.payment_failed</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.updated</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.released</code>, and
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.canceled</code>.
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <code class="flex-1 overflow-x-auto rounded-ctlSm bg-surface px-2 py-1 text-[12px] text-ink-600">{{ webhookUrl }}</code>
                </div>
              </div>
            </form>

            <p class="mt-10 text-center text-[11px] text-ink-faint2">
              <button type="button" class="hover:text-ink-muted2" @click="showLegacyForm = !showLegacyForm">
                {{ showLegacyForm ? 'hide advanced setup' : 'advanced setup' }}
              </button>
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
