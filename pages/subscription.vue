<script setup lang="ts">
interface SubscriptionRow {
  status: string
  billing_interval: string
  extra_professionals: number
  trial_ends_at: string | null
  comped: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan_id: string
  plans: {
    name: string
    monthly_price_cents: number
    annual_price_cents: number
    included_professionals: number | null
    extra_professional_price_cents: number | null
    included_whatsapp_conversations: number | null
    included_storage_gb: number | null
  } | null
}

interface PlanRow {
  id: string
  name: string
  monthly_price_cents: number
  annual_price_cents: number
  included_professionals: number | null
  included_clinics: number | null
  extra_professional_price_cents: number | null
  sort_order: number
}

interface BillingInfo {
  hasCustomer: boolean
  country?: string | null
  card?: { brand: string; last4: string } | null
  nextPaymentDate?: string | null
}

interface PaymentRow {
  saleId: string
  date: string
  product: string
  transactionAmountCents: number
  taxAmountCents: number
  status: 'success' | 'failed' | 'pending'
  method: { brand: string; last4: string } | null
  invoiceUrl: string | null
}

const route = useRoute()
const store = useAccountStore()
const supabase = useSupabaseClient()
const { loading: loadingPortal, openPortal } = useBillingPortal()

const subscription = ref<SubscriptionRow | null>(null)
const plans = ref<PlanRow[]>([])
const practitionerCount = ref(0)
const usage = ref<{ whatsapp_conversations_mtd: number; storage_bytes: number } | null>(null)
const loading = ref(true)

async function loadSubscription() {
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'status, billing_interval, extra_professionals, trial_ends_at, comped, stripe_customer_id, stripe_subscription_id, plan_id, plans(name, monthly_price_cents, annual_price_cents, included_professionals, extra_professional_price_cents, included_whatsapp_conversations, included_storage_gb)',
    )
    .eq('account_id', store.accountId!)
    .maybeSingle()
  subscription.value = data as SubscriptionRow | null
}

// WhatsApp conversations and file storage are the only two things in the
// product with a real marginal cost, so they are the only two the plans put a
// ceiling on. Read through account_usage() rather than counting here: it is
// SECURITY DEFINER, so the figure is the same account-level truth for every
// team member, instead of being filtered down to whatever patients the reader
// happens to have access to.
async function loadUsage() {
  const { data } = await supabase.rpc('account_usage', { target_account_id: store.accountId! })
  usage.value = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
}

async function loadPractitionerCount() {
  const { count } = await supabase
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', store.accountId!)
    .eq('is_practitioner', true)
    .is('deleted_at', null)
  practitionerCount.value = count ?? 0
}

// Billing info (country, card, next renewal date) is fetched eagerly on
// mount, not lazily on tab-open, because the page header needs the renewal
// date regardless of which tab is active.
const billingInfo = ref<BillingInfo | null>(null)
const loadingBillingInfo = ref(false)
async function loadBillingInfo() {
  if (!store.isOwner) return
  loadingBillingInfo.value = true
  try {
    billingInfo.value = await $fetch<BillingInfo>('/api/billing/billing-info')
  } catch {
    billingInfo.value = { hasCustomer: false }
  } finally {
    loadingBillingInfo.value = false
  }
}

onMounted(async () => {
  const [, { data: planRows }] = await Promise.all([
    loadSubscription(),
    supabase.from('plans').select('id, name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, extra_professional_price_cents, sort_order').order('sort_order'),
    loadPractitionerCount(),
    loadUsage(),
    loadBillingInfo(),
  ])
  plans.value = planRows ?? []
  loading.value = false

  // Checkout redirects back here before the webhook has necessarily landed
  // -- poll a few times rather than showing a stale "trialing" status right
  // after the customer just paid.
  if (route.query.checkout === 'success') {
    checkoutJustCompleted.value = true
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await loadSubscription()
      if (subscription.value?.stripe_subscription_id) break
    }
    await loadBillingInfo()
  }
})

function eur(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed',
  locked: 'Locked',
  canceled: 'Canceled',
}
const STATUS_TONE: Record<string, string> = {
  trialing: 'bg-blue-50 text-blue-700',
  active: 'bg-green-50 text-green-700',
  past_due: 'bg-red-50 text-red-700',
  locked: 'bg-red-50 text-red-700',
  canceled: 'bg-gray-100 text-gray-500',
}

const PAYMENT_STATUS_TONE: Record<PaymentRow['status'], string> = {
  success: 'text-green-700',
  failed: 'text-red-700',
  pending: 'text-ink-muted',
}

const monthlyEquivalentCents = computed(() => {
  const sub = subscription.value
  if (!sub?.plans) return 0
  const base = sub.billing_interval === 'annual' ? sub.plans.annual_price_cents : sub.plans.monthly_price_cents
  const overage = sub.extra_professionals > 0 ? sub.extra_professionals * (sub.plans.extra_professional_price_cents ?? 0) : 0
  return base + overage
})

// The actual amount the next charge will be for -- distinct from the
// monthly-equivalent shown in the plan card, since an annual plan's next
// charge is the full annual price, not 1/12th of it.
const nextChargeCents = computed(() => {
  const sub = subscription.value
  if (!sub?.plans) return 0
  const base = sub.billing_interval === 'annual' ? sub.plans.annual_price_cents : sub.plans.monthly_price_cents
  const overage = sub.extra_professionals > 0 ? sub.extra_professionals * (sub.plans.extra_professional_price_cents ?? 0) : 0
  return base + overage
})

// Only practitioners consume a seat -- front desk, practice managers and
// bookkeepers are free and unlimited, so the count has to say "practitioner",
// not "user", or an owner reads it as a cap on their whole team.
const seatsIncluded = computed(() => {
  const included = subscription.value?.plans?.included_professionals
  if (included === null || included === undefined) return null
  return included + (subscription.value?.extra_professionals ?? 0)
})

const professionalsLabel = computed(() => {
  const total = seatsIncluded.value
  if (total === null) return `${practitionerCount.value} practitioner(s) -- unlimited included`
  return `${practitionerCount.value} of ${total} practitioner seat(s) in use`
})

// Both allowances are presented as headroom, not as a meter. They exist so a
// clinic can see where it stands and so an overage conversation is possible --
// nothing in the app blocks a send or an upload when they are passed, because
// WhatsApp is how these clinics reach patients and cutting that off over a
// billing threshold would be a worse product than absorbing the overage.
const GB = 1024 ** 3

const usageRows = computed(() => {
  const plan = subscription.value?.plans
  const u = usage.value
  if (!plan || !u || subscription.value?.comped) return []
  const rows: { label: string; used: string; allowance: string; pct: number | null; over: boolean }[] = []

  if (plan.included_whatsapp_conversations) {
    const pct = Math.min(100, Math.round((u.whatsapp_conversations_mtd / plan.included_whatsapp_conversations) * 100))
    rows.push({
      label: 'WhatsApp conversations this month',
      used: u.whatsapp_conversations_mtd.toLocaleString('es-ES'),
      allowance: plan.included_whatsapp_conversations.toLocaleString('es-ES'),
      pct,
      over: u.whatsapp_conversations_mtd > plan.included_whatsapp_conversations,
    })
  }
  if (plan.included_storage_gb) {
    const usedGb = u.storage_bytes / GB
    const pct = Math.min(100, Math.round((usedGb / plan.included_storage_gb) * 100))
    rows.push({
      label: 'Patient file storage',
      used: `${usedGb.toFixed(usedGb < 10 ? 2 : 1)} GB`,
      allowance: `${plan.included_storage_gb} GB`,
      pct,
      over: usedGb > plan.included_storage_gb,
    })
  }
  return rows
})

// Comped accounts have no ceiling at all, so never nag them about seats.
const seatsFull = computed(
  () => !subscription.value?.comped && seatsIncluded.value !== null && practitionerCount.value >= seatsIncluded.value,
)

const contactHref = computed(() => {
  const subject = encodeURIComponent(`Question about my QuiroFlow plan -- ${store.accountName}`)
  return `mailto:hola@columnaquiro.com?subject=${subject}`
})

// Plan picker -- hidden entirely for comped accounts (admin-granted free
// access, not something the account itself should be changing).
const interval = ref<'monthly' | 'annual'>(subscription.value?.billing_interval === 'annual' ? 'annual' : 'monthly')
watch(subscription, (sub) => {
  if (sub) interval.value = sub.billing_interval === 'annual' ? 'annual' : 'monthly'
}, { once: true })

const extraProfessionals = ref(0)
watch(subscription, (sub) => {
  if (sub) extraProfessionals.value = sub.extra_professionals
}, { once: true })

function priceFor(plan: PlanRow) {
  const base = interval.value === 'annual' ? plan.annual_price_cents : plan.monthly_price_cents
  const overage = plan.extra_professional_price_cents ? extraProfessionals.value * plan.extra_professional_price_cents : 0
  return base + overage
}

function isCurrentPlan(plan: PlanRow) {
  const sub = subscription.value
  return !!sub && sub.plan_id === plan.id && sub.billing_interval === interval.value && sub.extra_professionals === extraProfessionals.value && !!sub.stripe_subscription_id
}

const changingPlanId = ref<string | null>(null)
const planError = ref('')
const checkoutJustCompleted = ref(false)

async function choosePlan(plan: PlanRow) {
  planError.value = ''
  changingPlanId.value = plan.id
  try {
    const result = await $fetch<{ url?: string; updated?: boolean }>('/api/billing/subscribe', {
      method: 'POST',
      body: { planId: plan.id, interval: interval.value, extraProfessionals: plan.extra_professional_price_cents ? extraProfessionals.value : 0 },
    })
    if (result.url) {
      window.location.href = result.url
      return
    }
    // Updated an existing subscription in place -- the webhook will land
    // shortly and sync the real numbers; refetch after a short beat.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await loadSubscription()
    await loadBillingInfo()
  } catch (err: any) {
    planError.value = err?.data?.statusMessage ?? 'Could not update your plan. Please try again.'
  } finally {
    changingPlanId.value = null
  }
}

// A brand-new subscription (no stripe_subscription_id yet) has nothing to
// preview -- the sticker price on the card already IS what Checkout will
// charge, so that case skips straight to choosePlan(). An in-place switch
// prorates against whatever's left of the current billing period, which the
// card price can't show, so that case previews first and only calls
// choosePlan() once the owner confirms the real amount.
const previewingPlanId = ref<string | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewResult = ref<{ amountDueCents: number; taxCents: number; currency: string } | null>(null)

async function requestPlanChange(plan: PlanRow) {
  if (!subscription.value?.stripe_subscription_id) {
    await choosePlan(plan)
    return
  }
  planError.value = ''
  previewError.value = ''
  previewResult.value = null
  previewingPlanId.value = plan.id
  previewLoading.value = true
  try {
    const result = await $fetch<{ previewable: boolean; amountDueCents?: number; taxCents?: number; currency?: string }>('/api/billing/preview', {
      method: 'POST',
      body: { planId: plan.id, interval: interval.value, extraProfessionals: plan.extra_professional_price_cents ? extraProfessionals.value : 0 },
    })
    if (!result.previewable || result.amountDueCents === undefined) {
      // Shouldn't happen given the stripe_subscription_id check above, but
      // fail open to the direct switch rather than leaving the owner stuck.
      previewingPlanId.value = null
      await choosePlan(plan)
      return
    }
    previewResult.value = { amountDueCents: result.amountDueCents, taxCents: result.taxCents ?? 0, currency: result.currency ?? 'eur' }
  } catch (err: any) {
    previewError.value = err?.data?.statusMessage ?? 'Could not calculate the price for this change.'
  } finally {
    previewLoading.value = false
  }
}

function cancelPreview() {
  previewingPlanId.value = null
  previewResult.value = null
  previewError.value = ''
}

async function confirmPlanChange(plan: PlanRow) {
  cancelPreview()
  await choosePlan(plan)
}

// Tabs -----------------------------------------------------------------
const activeTab = ref<'summary' | 'billing' | 'payments'>('summary')
const tabs = [
  { key: 'summary', label: 'Summary' },
  { key: 'billing', label: 'Billing info' },
  { key: 'payments', label: 'Payments' },
] as const

const payments = ref<PaymentRow[]>([])
const loadingPayments = ref(false)
const paymentsLoaded = ref(false)
async function loadPayments() {
  if (paymentsLoaded.value || !store.isOwner) return
  loadingPayments.value = true
  try {
    const result = await $fetch<{ payments: PaymentRow[] }>('/api/billing/payments')
    payments.value = result.payments
    paymentsLoaded.value = true
  } finally {
    loadingPayments.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'payments') loadPayments()
})

const headerMeta = computed(() => {
  if (!subscription.value || subscription.value.comped || !subscription.value.stripe_subscription_id) return undefined
  const parts = [`Recurring: ${STATUS_LABEL[subscription.value.status] ?? subscription.value.status}`]
  if (billingInfo.value?.nextPaymentDate) {
    parts.unshift(`Next payment: ${formatDate(billingInfo.value.nextPaymentDate)} -- ${eur(nextChargeCents.value)}`)
  }
  return parts.join('     ')
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Subscription info" :meta="headerMeta" />
    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
    <div class="max-w-3xl">

    <div class="mb-4 flex gap-1 border-b border-line">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="px-3 pb-2 text-sm"
        :class="activeTab === tab.key ? 'border-b-2 border-brand font-semibold text-ink-900' : 'text-ink-muted hover:text-ink-700'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="loading" class="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-center justify-between">
        <UiSkeleton class="h-4 w-24 rounded-ctlSm" />
        <UiSkeleton class="h-6 w-20 rounded-full" />
      </div>
      <UiSkeleton class="h-3 w-full rounded-ctlSm" />
      <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
    </div>
    <div v-else-if="!subscription" class="text-sm text-ink-muted">No subscription found. Contact <a :href="contactHref" class="text-brand hover:text-brand-hover">hola@columnaquiro.com</a>.</div>

    <template v-else>
      <!-- Summary tab -->
      <template v-if="activeTab === 'summary'">
        <p v-if="checkoutJustCompleted && !subscription.stripe_subscription_id" class="rounded-card border border-line bg-brand-tint px-4 py-3 text-sm text-brand-text">
          Payment received -- activating your subscription… this can take a few seconds.
        </p>

        <div class="mt-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <div class="flex items-center justify-between">
            <p class="text-base font-semibold text-ink-900">{{ subscription.plans?.name ?? 'Plan' }}</p>
            <span v-if="subscription.comped" class="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand">Comped -- no charge</span>
            <span v-else class="rounded-full px-2.5 py-1 text-xs font-medium" :class="STATUS_TONE[subscription.status] ?? 'bg-gray-100 text-gray-500'">
              {{ STATUS_LABEL[subscription.status] ?? subscription.status }}
            </span>
          </div>

          <p v-if="!subscription.comped" class="text-sm text-ink-700">
            {{ eur(monthlyEquivalentCents) }}/mo
            <span class="text-ink-muted">({{ subscription.billing_interval === 'annual' ? 'billed annually' : 'billed monthly' }})</span>
          </p>
          <p class="text-sm text-ink-muted">
            {{ professionalsLabel }}
            <span class="text-ink-faint2">&middot; admin users are free</span>
          </p>
          <p v-if="seatsFull" class="text-sm text-ink-muted">
            Every practitioner seat on your plan is in use. Adding another practitioner needs an extra seat
            <span v-if="subscription.plans?.extra_professional_price_cents">({{ eur(subscription.plans.extra_professional_price_cents) }}/mo)</span> —
            add one below. Non-practitioner staff can still be added at no cost.
          </p>

          <p v-if="subscription.status === 'trialing' && store.trialDaysLeft !== null" class="text-sm text-ink-muted">
            {{ store.trialDaysLeft === 0 ? 'Your trial ends today.' : `${store.trialDaysLeft} day(s) left in your free trial.` }}
          </p>
          <p v-if="subscription.status === 'past_due'" class="text-sm text-danger-text">Your last payment failed. Update your payment method to avoid losing access.</p>
          <p v-if="subscription.status === 'locked' || subscription.status === 'canceled'" class="text-sm text-danger-text">This account is locked pending payment.</p>

          <div v-if="store.isOwner" class="flex flex-wrap items-center gap-4 pt-2">
            <UiBtn v-if="subscription.stripe_customer_id" variant="secondary" :disabled="loadingPortal" @click="openPortal(contactHref)">
              {{ loadingPortal ? 'Opening…' : 'Manage payment method & invoices' }}
            </UiBtn>
            <p v-else-if="subscription.comped" class="text-sm text-ink-muted">This account has complimentary access -- no billing to manage.</p>
            <button
              v-if="subscription.stripe_subscription_id && subscription.status !== 'canceled'"
              type="button"
              class="text-sm text-ink-muted underline decoration-dotted hover:text-danger-text disabled:opacity-50"
              :disabled="loadingPortal"
              @click="openPortal(contactHref, 'cancel')"
            >
              Cancel subscription
            </button>
          </div>
        </div>

        <div v-if="usageRows.length > 0" class="mt-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <div>
            <h2 class="text-sm font-semibold text-ink-900">Included usage</h2>
            <p class="mt-0.5 text-[12.5px] text-ink-muted2">
              Generous limits rather than a meter -- going over never blocks messages or uploads, we just get in touch.
            </p>
          </div>
          <div v-for="row in usageRows" :key="row.label" class="space-y-1.5">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-[13px] text-ink-700">{{ row.label }}</span>
              <span class="font-mono text-[12.5px] tabular-nums" :class="row.over ? 'text-danger-text' : 'text-ink-muted'">
                {{ row.used }} / {{ row.allowance }}
              </span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-subtle">
              <div
                class="h-full rounded-full"
                :class="row.over ? 'bg-danger-text' : 'bg-brand'"
                :style="{ width: `${Math.max(row.pct ?? 0, 2)}%` }"
              />
            </div>
          </div>
        </div>

        <div v-if="store.isOwner && !subscription.comped" class="mt-8">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-ink-900">Change plan</h2>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1.5 text-sm">
                <label class="flex items-center gap-1.5">
                  <span class="text-ink-muted">Extra professionals</span>
                  <input
                    v-model.number="extraProfessionals"
                    type="number"
                    min="0"
                    class="w-14 rounded-ctl border border-line-control px-2 py-1 text-center text-sm focus:border-brand focus:outline-none"
                  />
                </label>
              </div>
              <div class="flex rounded-ctl border border-line-control p-0.5">
                <button
                  type="button"
                  class="rounded-ctlSm px-3 py-1 text-xs font-medium"
                  :class="interval === 'monthly' ? 'bg-brand text-white' : 'text-ink-600'"
                  @click="interval = 'monthly'"
                >
                  Monthly
                </button>
                <button
                  type="button"
                  class="rounded-ctlSm px-3 py-1 text-xs font-medium"
                  :class="interval === 'annual' ? 'bg-brand text-white' : 'text-ink-600'"
                  @click="interval = 'annual'"
                >
                  Annual
                </button>
              </div>
            </div>
          </div>

          <p v-if="planError" class="mt-3 text-sm text-danger-text">{{ planError }}</p>

          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div
              v-for="plan in plans"
              :key="plan.id"
              class="flex flex-col gap-3 rounded-card border p-4"
              :class="isCurrentPlan(plan) ? 'border-brand shadow-card' : 'border-line'"
            >
              <div>
                <p class="text-sm font-semibold text-ink-900">{{ plan.name }}</p>
                <p class="mt-1 text-xl font-semibold text-ink-900">
                  {{ eur(priceFor(plan)) }}<span class="text-sm font-normal text-ink-muted">/mo</span>
                </p>
                <p class="text-xs text-ink-muted">{{ interval === 'annual' ? 'billed annually' : 'billed monthly' }}</p>
              </div>
              <ul class="flex-1 space-y-1 text-xs text-ink-muted">
                <li>{{ plan.included_professionals ?? 'Unlimited' }} professional(s) included</li>
                <li>{{ plan.included_clinics ?? 'Unlimited' }} clinic location(s)</li>
                <li v-if="plan.extra_professional_price_cents">{{ eur(plan.extra_professional_price_cents) }}/mo per extra professional</li>
              </ul>
              <UiBtn
                v-if="isCurrentPlan(plan)"
                variant="secondary"
                disabled
              >
                Current plan
              </UiBtn>

              <!-- Previewing this specific card's proration before committing
                   to it -- only reachable when there's a real subscription to
                   prorate against (requestPlanChange() skips straight to
                   choosePlan() otherwise). -->
              <template v-else-if="previewingPlanId === plan.id">
                <p v-if="previewLoading" class="text-xs text-ink-muted">Checking the price…</p>
                <template v-else-if="previewResult">
                  <p class="text-xs text-ink-700">
                    You'll be charged <span class="font-semibold">{{ eur(previewResult.amountDueCents) }}</span> now
                    <span class="text-ink-muted">(prorated{{ previewResult.taxCents > 0 ? ', incl. tax' : '' }})</span>.
                  </p>
                  <div class="flex gap-2">
                    <UiBtn variant="primary" class="flex-1" :disabled="changingPlanId !== null" @click="confirmPlanChange(plan)">
                      {{ changingPlanId === plan.id ? 'Please wait…' : 'Confirm switch' }}
                    </UiBtn>
                    <UiBtn variant="secondary" :disabled="changingPlanId !== null" @click="cancelPreview">Cancel</UiBtn>
                  </div>
                </template>
                <template v-else-if="previewError">
                  <p class="text-xs text-danger-text">{{ previewError }}</p>
                  <UiBtn variant="secondary" @click="cancelPreview">Dismiss</UiBtn>
                </template>
              </template>

              <UiBtn
                v-else
                variant="primary"
                :disabled="changingPlanId !== null || previewLoading"
                @click="requestPlanChange(plan)"
              >
                {{ subscription.stripe_subscription_id ? 'Switch to this plan' : 'Subscribe' }}
              </UiBtn>
            </div>
          </div>
        </div>
      </template>

      <!-- Billing info tab -->
      <template v-else-if="activeTab === 'billing'">
        <div v-if="!store.isOwner" class="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          Only the account owner can view billing details.
        </div>
        <div v-else-if="loadingBillingInfo" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UiSkeleton class="h-32 rounded-card" />
          <UiSkeleton class="h-32 rounded-card" />
        </div>
        <div v-else-if="!billingInfo?.hasCustomer" class="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          No billing details yet -- start a subscription first.
        </div>
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-ink-900">Billing information</p>
              <button type="button" class="text-xs font-medium text-brand-text hover:text-brand-hover" @click="openPortal(contactHref)">Edit</button>
            </div>
            <p class="mt-3 text-xs text-ink-muted">Changes to your billing information will take effect starting with the next scheduled payment.</p>
            <p class="mt-4 text-sm text-ink-700"><span class="font-medium text-ink-900">Country:</span> {{ billingInfo?.country ?? '--' }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-ink-900">Current card</p>
              <button type="button" class="text-xs font-medium text-brand-text hover:text-brand-hover" @click="openPortal(contactHref)">Edit</button>
            </div>
            <div v-if="billingInfo?.card" class="mt-4 rounded-ctl bg-surface-page px-3 py-2 text-sm text-ink-700">
              <span class="capitalize">{{ billingInfo.card.brand }}</span>
              <span class="ml-2 text-ink-muted">•••• {{ billingInfo.card.last4 }}</span>
            </div>
            <p v-else class="mt-4 text-sm text-ink-muted">No card on file.</p>
          </div>
        </div>
      </template>

      <!-- Payments tab -->
      <template v-else-if="activeTab === 'payments'">
        <div v-if="!store.isOwner" class="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          Only the account owner can view billing details.
        </div>
        <div v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div v-if="loadingPayments" class="space-y-2 p-4">
            <UiSkeleton class="h-8 w-full rounded-ctlSm" />
            <UiSkeleton class="h-8 w-full rounded-ctlSm" />
            <UiSkeleton class="h-8 w-full rounded-ctlSm" />
          </div>
          <p v-else-if="payments.length === 0" class="p-4 text-sm text-ink-muted">No payments yet.</p>
          <table v-else class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-line text-xs text-ink-muted">
                <th class="px-4 py-2 font-medium">Sale ID</th>
                <th class="px-4 py-2 font-medium">Date</th>
                <th class="px-4 py-2 font-medium">Product</th>
                <th class="px-4 py-2 text-right font-medium">Transaction Amount</th>
                <th class="px-4 py-2 text-right font-medium">Tax Amount</th>
                <th class="px-4 py-2 font-medium">Status</th>
                <th class="px-4 py-2 font-medium">Method</th>
                <th class="px-4 py-2 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in payments" :key="row.saleId" class="border-b border-line last:border-0">
                <td class="px-4 py-2 text-ink-700">{{ row.saleId }}</td>
                <td class="px-4 py-2 text-ink-700">{{ new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }) }}</td>
                <td class="px-4 py-2 text-ink-700">{{ row.product }}</td>
                <td class="px-4 py-2 text-right text-ink-700">{{ eur(row.transactionAmountCents) }}</td>
                <td class="px-4 py-2 text-right text-ink-700">{{ eur(row.taxAmountCents) }}</td>
                <td class="px-4 py-2 font-medium" :class="PAYMENT_STATUS_TONE[row.status]">{{ row.status }}</td>
                <td class="px-4 py-2 text-ink-700">{{ row.method ? `${row.method.brand} ${row.method.last4}` : '--' }}</td>
                <td class="px-4 py-2">
                  <a v-if="row.invoiceUrl" :href="row.invoiceUrl" target="_blank" rel="noopener" class="text-xs font-medium text-brand-text hover:text-brand-hover">View</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
    </div>
    </div>
  </div>
</template>
