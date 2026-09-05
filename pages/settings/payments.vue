<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const t = useT()

const connectAccountId = ref<string | null>(null)
const publishableKey = ref('')
const secretKey = ref('')
const hasStoredSecretKey = ref(false)
const webhookSecret = ref('')
const hasStoredWebhookSecret = ref(false)
const showLegacyForm = ref(false)

const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)

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
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    stripe_publishable_key: publishableKey.value.trim() || null,
  }
  if (secretKey.value.trim()) update.stripe_secret_key = secretKey.value.trim()
  if (webhookSecret.value.trim()) update.stripe_webhook_secret = webhookSecret.value.trim()

  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast('Saved')
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
    testResult.value = res.livemode ? t('Connected — live mode.', 'Conectado — modo real.') : t('Connected — test mode.', 'Conectado — modo de prueba.')
  } catch (err: any) {
    testError.value = err?.data?.statusMessage ?? t('Connection failed', 'Error de conexión')
  } finally {
    testing.value = false
  }
}

async function disconnect() {
  if (!confirm(t('Disconnect this Stripe account? Existing schedules keep running on Stripe, but QuiroFlow will stop being able to charge new cards until you reconnect.', '¿Desconectar esta cuenta de Stripe? Los calendarios existentes seguirán funcionando en Stripe, pero QuiroFlow dejará de poder cobrar nuevas tarjetas hasta que vuelvas a conectarla.'))) return
  await supabase.from('accounts').update({ stripe_connect_account_id: null }).eq('id', store.accountId!)
  connectAccountId.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Payments (Stripe)', 'Pagos (Stripe)')">
      <UiBtn v-if="showLegacyForm" variant="primary" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('Automate installments and renewals with a saved card. Connect your own Stripe account to charge patients automatically — package installments or membership renewals billed on schedule without staff having to do anything.', 'Automatiza pagos aplazados y renovaciones con una tarjeta guardada. Conecta tu propia cuenta de Stripe para cobrar a los pacientes automáticamente — plazos de bonos o renovaciones de membresía facturados según calendario sin que el personal tenga que hacer nada.') }}
          </p>

          <div v-if="justConnected" class="mt-4 rounded-ctl border border-success-border bg-success-bg p-3 text-[12.5px] text-success-deep">
            {{ t('Stripe account connected.', 'Cuenta de Stripe conectada.') }}
          </div>
          <div v-if="connectError" class="mt-4 rounded-ctl border border-danger-border bg-danger-bg p-3 text-[12.5px] text-danger-text">
            {{ connectError }}
          </div>

          <div v-if="loading" class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <div class="space-y-1.5">
                <UiSkeleton class="h-3.5 w-56 rounded-ctlSm" />
                <UiSkeleton class="h-3 w-40 rounded-ctlSm" />
              </div>
              <UiSkeleton class="h-4 w-24 rounded-ctlSm" />
            </div>
          </div>
          <template v-else>
            <div v-if="connectAccountId" class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Connected via Stripe Connect', 'Conectado mediante Stripe Connect') }}</p>
                  <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ t('Account', 'Cuenta') }} <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">{{ connectAccountId }}</code></p>
                </div>
                <div class="flex items-center gap-3">
                  <button type="button" :disabled="testing" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-50" @click="testConnection">
                    {{ testing ? t('Testing…', 'Probando…') : t('Test connection', 'Probar conexión') }}
                  </button>
                  <button type="button" class="text-[12.5px] font-medium text-danger-text hover:text-danger-text/80" @click="disconnect">{{ t('Disconnect', 'Desconectar') }}</button>
                </div>
              </div>
              <p class="mt-2 text-[12px] text-ink-faint">
                {{ t('No webhook setup needed — events are routed to QuiroFlow automatically for every connected clinic.', 'No es necesario configurar ningún webhook — los eventos se enrutan a QuiroFlow automáticamente para cada clínica conectada.') }}
              </p>
              <p v-if="testResult" class="mt-2 text-[12.5px] text-success-text">{{ testResult }}</p>
              <p v-if="testError" class="mt-2 text-[12.5px] text-danger-text">{{ testError }}</p>
            </div>

            <div v-else class="mt-6 rounded-card border border-line bg-surface p-6 text-center shadow-card">
              <p class="text-[13px] text-ink-600">{{ t('Connect your Stripe account in one click — no API keys to copy.', 'Conecta tu cuenta de Stripe con un clic — sin necesidad de copiar claves de API.') }}</p>
              <a
                href="/api/stripe/connect/start"
                class="mt-3 inline-flex h-8 items-center gap-2 rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover"
              >
                {{ t('Connect with Stripe', 'Conectar con Stripe') }}
              </a>
            </div>

            <form v-if="showLegacyForm" class="mt-4 space-y-3" @submit.prevent="save">
              <p class="text-[12.5px] text-ink-muted2">
                {{ t('Legacy path: paste your own Stripe API keys directly. Prefer "Connect with Stripe" above when possible.', 'Vía anterior: pega directamente tus propias claves de API de Stripe. Se recomienda usar "Conectar con Stripe" arriba cuando sea posible.') }}
              </p>
              <SettingsFieldRow :label="t('Publishable key', 'Clave publicable')">
                <input
                  v-model="publishableKey"
                  type="text"
                  placeholder="pk_test_…"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <SettingsFieldRow :label="t('Secret key', 'Clave secreta')">
                <input
                  v-model="secretKey"
                  type="password"
                  autocomplete="off"
                  :placeholder="hasStoredSecretKey ? '••••••••••••••••••••' : 'sk_test_…'"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <SettingsFieldRow
                :label="t('Webhook signing secret', 'Secreto de firma del webhook')"
                :helper="t('From the Stripe dashboard once you register the webhook URL below.', 'Desde el panel de Stripe una vez registres la URL del webhook de abajo.')"
              >
                <input
                  v-model="webhookSecret"
                  type="password"
                  autocomplete="off"
                  :placeholder="hasStoredWebhookSecret ? '••••••••••••••••••••' : 'whsec_…'"
                  class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </SettingsFieldRow>

              <div class="rounded-card border border-line bg-surface-subtle p-4">
                <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Webhook', 'Webhook') }}</h3>
                <p class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2">
                  {{ t('Register this URL in your Stripe dashboard under', 'Registra esta URL en tu panel de Stripe en') }} <strong>Developers &rarr; Webhooks</strong>, {{ t('listening for', 'escuchando') }}
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">invoice.paid</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">invoice.payment_failed</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.updated</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.released</code>,
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">subscription_schedule.canceled</code>, {{ t('and', 'y') }}
                  <code class="rounded-ctlSm bg-surface px-1 py-0.5 text-[12px]">setup_intent.succeeded</code>.
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <code class="flex-1 overflow-x-auto rounded-ctlSm bg-surface px-2 py-1 text-[12px] text-ink-600">{{ webhookUrl }}</code>
                </div>
              </div>
            </form>

            <p class="mt-10 text-center text-[11px] text-ink-faint2">
              <button type="button" class="hover:text-ink-muted2" @click="showLegacyForm = !showLegacyForm">
                {{ showLegacyForm ? t('hide advanced setup', 'ocultar configuración avanzada') : t('advanced setup', 'configuración avanzada') }}
              </button>
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
