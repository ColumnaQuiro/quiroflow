<script setup lang="ts">
import type { Tables, TablesUpdate } from '~/types/database.types'

// Settings > Payments: how money comes in. The payment methods staff record
// a payment with, and card payments through Stripe -- which is the one
// method that needs a connection. These were two pages
// (/settings/payment-methods now redirects here).

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
    .select('stripe_connect_account_id, stripe_publishable_key')
    .eq('id', store.accountId!)
    .maybeSingle()
  connectAccountId.value = data?.stripe_connect_account_id ?? null
  publishableKey.value = data?.stripe_publishable_key ?? ''
  // The secrets are not selectable from here any more -- account_secrets
  // grants nothing to the browser. This endpoint reports only whether each is
  // set, which is all the form ever displayed.
  try {
    const status = await useStaffFetch<{ stripeSecretKey: boolean; stripeWebhookSecret: boolean }>('/api/stripe/secrets')
    hasStoredSecretKey.value = status.stripeSecretKey
    hasStoredWebhookSecret.value = status.stripeWebhookSecret
  } catch {
    hasStoredSecretKey.value = false
    hasStoredWebhookSecret.value = false
  }
  showLegacyForm.value = !connectAccountId.value && hasStoredSecretKey.value
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    stripe_publishable_key: publishableKey.value.trim() || null,
  }

  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  if (updateError) {
    saving.value = false
    showToast(updateError.message, 'error')
    return
  }

  // Separate endpoint, not part of the accounts update above, because the
  // browser cannot write these columns at all any more.
  if (secretKey.value.trim() || webhookSecret.value.trim()) {
    try {
      await useStaffFetch('/api/stripe/secrets', {
        method: 'POST',
        body: { secretKey: secretKey.value.trim(), webhookSecret: webhookSecret.value.trim() },
      })
    } catch (e: any) {
      saving.value = false
      showToast(e?.data?.statusMessage ?? e?.statusMessage ?? t('Could not save the Stripe keys', 'No se pudieron guardar las claves de Stripe'), 'error')
      return
    }
  }

  saving.value = false
  showToast(t('Saved', 'Guardado'))
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

// Asked in an in-app dialog rather than confirm(), which states the question
// with none of the consequences.
const disconnectOpen = ref(false)
async function disconnect() {
  const { data: saved, error } = await supabase.from('accounts').update({ stripe_connect_account_id: null }).eq('id', store.accountId!).select('id')
  if (error || !saved?.length) {
    showToast(error?.message ?? t('Stripe is still connected: the change was not saved.', 'Stripe sigue conectado: no se ha guardado el cambio.'), 'error')
    return
  }
  connectAccountId.value = null
  disconnectOpen.value = false
}

// --- payment methods, formerly /settings/payment-methods ---

// The pickers cache this list; without invalidating, a method added here
// would not appear on a Billing tab until a full page reload.
const { invalidate: invalidatePaymentMethods, displayName: methodLabel } = usePaymentMethods()

const methods = ref<Tables<'payment_methods'>[]>([])
const methodUses = ref<Record<string, number>>({})
const methodsLoading = ref(true)
const newMethod = ref('')
const addingMethod = ref(false)
const methodError = ref('')

async function loadMethods() {
  // is_system excluded: 'credit' and 'write_off' exist as rows so payments can
  // reference them, but they carry behaviour and renaming or deactivating one
  // would break the forms that special-case them. They are shown below as
  // built in, not managed here.
  const { data } = await supabase.from('payment_methods').select('*').eq('is_system', false).order('sort_order').order('name')
  methods.value = data ?? []
  invalidatePaymentMethods()
  methodsLoading.value = false
  // How many payments name each method: what decides whether it can be
  // deleted at all (the foreign key refuses a used one), so the page offers
  // Delete only where it would work.
  const counts = await Promise.all(methods.value.map((m) => supabase.from('payments').select('id', { count: 'exact', head: true }).eq('method', m.key)))
  methodUses.value = Object.fromEntries(methods.value.map((m, i) => [m.id, counts[i].count ?? 0]))
}
onMounted(loadMethods)

function usesLabel(m: Tables<'payment_methods'>) {
  const n = methodUses.value[m.id]
  if (n === undefined) return ''
  if (n === 0) return t('Not used yet', 'Aún sin usar')
  return n === 1 ? t('1 payment', '1 pago') : t(`${n} payments`, `${n} pagos`)
}

// The key is what gets written to payments.method and never changes again --
// the name above it is a label staff can re-word whenever they like. Deriving
// it from the name once, here, is what lets "Transferencia bancaria" be
// renamed to "Transferencia" later without orphaning the payments taken under
// the old wording.
function keyFrom(name: string) {
  const base = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || 'method'
}

async function addMethod() {
  methodError.value = ''
  if (!newMethod.value.trim()) return
  addingMethod.value = true
  let key = keyFrom(newMethod.value)
  // Two methods a staff member would read as different ("Bizum" and "bizum ")
  // collapse to one key, and the unique index would refuse the second with a
  // constraint message nobody can act on.
  // credit and write_off are hidden rows, not absent ones: a method called
  // "Credit" collided with them and failed with a raw duplicate-key error.
  const taken = new Set([...methods.value.map((m) => m.key), 'credit', 'write_off'])
  if (taken.has(key)) {
    let n = 2
    while (taken.has(`${key}_${n}`)) n++
    key = `${key}_${n}`
  }
  const { error: insertError } = await supabase.from('payment_methods').insert({
    account_id: store.accountId!,
    key,
    name: newMethod.value.trim(),
    sort_order: methods.value.length,
  })
  addingMethod.value = false
  if (insertError) {
    methodError.value = insertError.message
    return
  }
  newMethod.value = ''
  await loadMethods()
}

async function toggleActive(method: Tables<'payment_methods'>, active: boolean) {
  method.is_active = active
  await supabase.from('payment_methods').update({ is_active: active }).eq('id', method.id)
  invalidatePaymentMethods()
}

async function removeMethod(method: Tables<'payment_methods'>) {
  methodError.value = ''
  const { error: deleteError } = await supabase.from('payment_methods').delete().eq('id', method.id)
  // Delete is only offered on a method nothing names, but a payment can be
  // taken with it between the count and the click; the foreign key refuses
  // then, and turning it off is the answer that keeps the history.
  if (deleteError) {
    methodError.value = t(
      'This method has payments recorded against it, so it cannot be deleted. Turn it off instead -- it disappears from the payment forms and the history stays intact.',
      'Este método tiene pagos registrados, así que no se puede eliminar. Desactívalo en su lugar: desaparece de los formularios de pago y el historial se mantiene.',
    )
    await loadMethods()
    return
  }
  await loadMethods()
}

// A line icon per well-known method; anything a clinic adds gets the generic one.
const METHOD_ICONS: Record<string, string> = {
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4',
  card: 'M3 5h18v14H3zM3 10h18M7 15h4',
  bizum: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  transfer: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
}
const GENERIC_ICON = 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'
</script>


<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Payments', 'Pagos')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="payments-settings" :data-ready="methodsLoading || loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('How money comes in: the methods staff record a payment with, and card payments through Stripe.', 'Cómo entra el dinero: los métodos con los que se registra un pago, y los cobros con tarjeta mediante Stripe.') }}
          </p>

          <!-- Payment methods -->
          <section aria-labelledby="h-methods" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <div class="flex-1">
                <h2 id="h-methods" class="text-[16px] font-bold text-ink-900">{{ t(`Payment methods · ${methods.length}`, `Métodos de pago · ${methods.length}`) }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">
                  {{ t('What staff pick when they record a payment. Turn one off to stop offering it; payments already taken keep it.', 'Lo que elige el personal al registrar un pago. Desactiva uno para dejar de ofrecerlo; los pagos ya registrados lo conservan.') }}
                </p>
              </div>
              <span class="text-[13px] text-ink-muted max-sm:hidden">{{ t('Offered', 'Disponible') }}</span>
            </div>

            <template v-if="methodsLoading">
              <div v-for="i in 3" :key="i" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-9 w-9 rounded-ctl" />
                <UiSkeleton class="h-4 w-32 rounded-ctlSm" />
              </div>
            </template>

            <div v-for="m in methods" :key="m.id" data-cy="method-row" class="flex min-h-[64px] items-center gap-3.5 border-t border-line-row px-[18px] py-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl" :class="m.is_active ? 'bg-brand-tint text-brand-text' : 'bg-chip-bg text-ink-muted'" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="METHOD_ICONS[m.key] ?? GENERIC_ICON" /></svg>
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="text-[15px]" :class="m.is_active ? 'text-ink-900' : 'text-ink-500'" data-cy="method-name">{{ methodLabel(m) }}</strong>
                <span class="text-[13px] text-ink-muted" data-cy="method-uses">{{ usesLabel(m) }}</span>
              </div>
              <button
                v-if="methodUses[m.id] === 0"
                type="button"
                data-cy="method-delete"
                class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
                :aria-label="t(`Delete ${methodLabel(m)}`, `Eliminar ${methodLabel(m)}`)"
                @click="removeMethod(m)"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
              <button
                type="button"
                role="switch"
                data-cy="method-active"
                :aria-checked="m.is_active"
                :aria-label="t(`Offer ${methodLabel(m)}`, `Ofrecer ${methodLabel(m)}`)"
                class="relative h-[26px] w-11 shrink-0 rounded-full"
                :class="m.is_active ? 'bg-brand' : 'bg-line-control'"
                @click="toggleActive(m, !m.is_active)"
              >
                <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="m.is_active ? 'left-[21px]' : 'left-[3px]'" />
              </button>
            </div>

            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3" @submit.prevent="addMethod">
              <input
                v-model="newMethod"
                data-cy="method-new-name"
                type="text"
                :placeholder="t('Add a method, e.g. Cheque', 'Añade un método, ej. Cheque')"
                :aria-label="t('New payment method', 'Nuevo método de pago')"
                class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <UiBtn type="submit" data-cy="method-add" :disabled="addingMethod || !newMethod.trim()">{{ addingMethod ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="methodError" class="w-full text-[12.5px] font-semibold text-danger-text" data-cy="method-error">{{ methodError }}</p>
            </form>

            <div class="flex flex-col gap-2 border-t border-line px-[18px] pb-3.5 pt-3">
              <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Built in, always available', 'Integrados, siempre disponibles') }}</span>
              <div class="flex flex-wrap gap-2">
                <span v-for="label in [t('Credit on account', 'Saldo a favor'), t('Write-off', 'Baja contable')]" :key="label" class="inline-flex h-7 items-center gap-1.5 rounded-pill bg-chip-bg px-2.5 text-[13px] text-ink-500">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                  {{ label }}
                </span>
              </div>
              <span class="text-[12.5px] text-ink-muted">{{ t('Tied to the patient’s real balance, so they are not managed here.', 'Vinculados al saldo real del paciente, así que no se gestionan aquí.') }}</span>
            </div>
          </section>

          <!-- Stripe -->
          <section aria-labelledby="h-stripe" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="stripe-section">
            <div class="flex items-start gap-3.5 px-[18px] py-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-tint text-brand-text" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2.5">
                  <h2 id="h-stripe" class="text-[16px] font-bold text-ink-900">{{ t('Card payments with Stripe', 'Cobros con tarjeta con Stripe') }}</h2>
                  <UiSkeleton v-if="loading" class="h-6 w-24 rounded-pill" />
                  <UiPill v-else-if="connectAccountId" tone="success" dot data-cy="stripe-status">{{ t('Connected', 'Conectado') }}</UiPill>
                  <UiPill v-else-if="hasStoredSecretKey" tone="neutral" data-cy="stripe-status">{{ t('Using API keys', 'Con claves de API') }}</UiPill>
                  <UiPill v-else tone="neutral" data-cy="stripe-status">{{ t('Not connected', 'Sin conectar') }}</UiPill>
                </div>
                <p class="text-[13.5px] leading-snug text-ink-500">
                  {{ t('Charges a patient’s saved card on a schedule, without anyone at the desk doing it.', 'Cobra la tarjeta guardada de un paciente según un calendario, sin que nadie en recepción tenga que hacerlo.') }}
                </p>
              </div>
            </div>

            <div v-if="justConnected" class="mx-[18px] mb-3 rounded-ctl border border-success-border bg-success-bg px-3 py-2.5 text-[13px] text-success-deep">
              {{ t('Stripe account connected.', 'Cuenta de Stripe conectada.') }}
            </div>
            <div v-if="connectError" class="mx-[18px] mb-3 rounded-ctl border border-danger-border bg-danger-bg px-3 py-2.5 text-[13px] text-danger-text">{{ connectError }}</div>

            <div class="grid grid-cols-1 gap-2.5 px-[18px] pb-4 sm:grid-cols-3">
              <div v-for="use in [
                { title: t('Bono instalments', 'Bonos a plazos'), text: t('Split a bono into scheduled charges.', 'Divide un bono en cobros programados.') },
                { title: t('Membership renewals', 'Renovación de membresías'), text: t('Charged every period the plan sets.', 'Se cobra cada periodo que marca el plan.') },
                { title: t('Saved cards', 'Tarjetas guardadas'), text: t('A patient adds a card once, from a link.', 'El paciente añade una tarjeta una vez, desde un enlace.') },
              ]" :key="use.title" class="flex flex-col gap-1 rounded-ctl border border-line-row bg-surface-subtle px-3.5 py-3">
                <strong class="text-[13.5px] text-ink-900">{{ use.title }}</strong>
                <span class="text-[12.5px] text-ink-muted">{{ use.text }}</span>
              </div>
            </div>

            <template v-if="!loading">
              <div v-if="connectAccountId" class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3">
                <span class="text-[13px] text-ink-muted">{{ t('Account', 'Cuenta') }}</span>
                <code class="rounded-ctlSm bg-surface-page px-2 py-1 font-mono text-[12.5px] text-ink-500">{{ connectAccountId }}</code>
                <span class="flex-1 text-[12.5px] text-ink-muted">{{ t('No webhook to set up.', 'Sin webhook que configurar.') }}</span>
                <UiBtn :disabled="testing" data-cy="stripe-test" @click="testConnection">{{ testing ? t('Testing…', 'Probando…') : t('Test connection', 'Probar conexión') }}</UiBtn>
                <UiBtn class="!border-danger-border !text-danger-text" data-cy="stripe-disconnect" @click="disconnectOpen = true">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
                <p v-if="testResult" class="w-full text-[12.5px] font-semibold text-success-text">{{ testResult }}</p>
                <p v-if="testError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ testError }}</p>
              </div>
              <div v-else class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3">
                <span class="flex-1 text-[13.5px] text-ink-700">{{ t('Connect your Stripe account in one click. No API keys to copy.', 'Conecta tu cuenta de Stripe con un clic. Sin claves de API que copiar.') }}</span>
                <a href="/api/stripe/connect/start" data-cy="stripe-connect" class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover">
                  {{ t('Connect with Stripe', 'Conectar con Stripe') }}
                </a>
              </div>

              <div class="border-t border-line">
                <button type="button" class="flex min-h-[48px] w-full items-center gap-2 px-[18px] text-left text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle" :aria-expanded="showLegacyForm" @click="showLegacyForm = !showLegacyForm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform" :class="showLegacyForm ? 'rotate-90' : ''"><path d="M9 6l6 6-6 6" /></svg>
                  {{ t('Advanced: use your own Stripe API keys instead', 'Avanzado: usar tus propias claves de API de Stripe') }}
                </button>
                <form v-if="showLegacyForm" class="flex flex-col gap-3 px-[18px] pb-4" @submit.prevent="save">
                  <p class="text-[12.5px] text-ink-muted">
                    {{ t('Paste your own Stripe keys. Prefer "Connect with Stripe" when you can.', 'Pega tus propias claves de Stripe. Mejor "Conectar con Stripe" cuando sea posible.') }}
                  </p>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    {{ t('Publishable key', 'Clave publicable') }}
                    <input v-model="publishableKey" type="text" placeholder="pk_test_…" class="h-9 touch:h-11 max-w-[360px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    {{ t('Secret key', 'Clave secreta') }}
                    <input v-model="secretKey" type="password" autocomplete="off" :placeholder="hasStoredSecretKey ? '••••••••••••••••••••' : 'sk_test_…'" class="h-9 touch:h-11 max-w-[360px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    {{ t('Webhook signing secret', 'Secreto de firma del webhook') }}
                    <input v-model="webhookSecret" type="password" autocomplete="off" :placeholder="hasStoredWebhookSecret ? '••••••••••••••••••••' : 'whsec_…'" class="h-9 touch:h-11 max-w-[360px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
                  </label>
                  <div class="rounded-ctl border border-line bg-surface-subtle p-3.5 text-[12.5px] leading-relaxed text-ink-500">
                    {{ t('Register this URL in your Stripe dashboard under', 'Registra esta URL en tu panel de Stripe en') }} <strong>Developers → Webhooks</strong>, {{ t('listening for', 'escuchando') }}
                    <code class="rounded-ctlSm bg-surface px-1 py-0.5">invoice.paid</code>, <code class="rounded-ctlSm bg-surface px-1 py-0.5">invoice.payment_failed</code>,
                    <code class="rounded-ctlSm bg-surface px-1 py-0.5">subscription_schedule.updated</code>, <code class="rounded-ctlSm bg-surface px-1 py-0.5">subscription_schedule.released</code>,
                    <code class="rounded-ctlSm bg-surface px-1 py-0.5">subscription_schedule.canceled</code> {{ t('and', 'y') }} <code class="rounded-ctlSm bg-surface px-1 py-0.5">setup_intent.succeeded</code>.
                    <code class="mt-2 block overflow-x-auto rounded-ctlSm bg-surface px-2 py-1.5 text-ink-700">{{ webhookUrl }}</code>
                  </div>
                  <div>
                    <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save keys', 'Guardar claves') }}</UiBtn>
                  </div>
                </form>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="disconnectOpen"
      tone="danger"
      :title="t('Disconnect Stripe?', '¿Desconectar Stripe?')"
      :confirm-label="t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="disconnect"
      @cancel="disconnectOpen = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Schedules already running keep running on Stripe, but QuiroFlow cannot charge new cards until you connect again.', 'Los calendarios que ya están en marcha siguen en Stripe, pero QuiroFlow no puede cobrar tarjetas nuevas hasta que vuelvas a conectar.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
