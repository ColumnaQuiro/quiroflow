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

const route = useRoute()
const store = useAccountStore()
const supabase = useSupabaseClient()
const { loading: loadingPortal, openPortal } = useBillingPortal()

const subscription = ref<SubscriptionRow | null>(null)
const plans = ref<PlanRow[]>([])
const loading = ref(true)

async function loadSubscription() {
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'status, billing_interval, extra_professionals, trial_ends_at, comped, stripe_customer_id, stripe_subscription_id, plan_id, plans(name, monthly_price_cents, annual_price_cents, included_professionals, extra_professional_price_cents)',
    )
    .eq('account_id', store.accountId!)
    .maybeSingle()
  subscription.value = data as SubscriptionRow | null
}

onMounted(async () => {
  const [, { data: planRows }] = await Promise.all([
    loadSubscription(),
    supabase.from('plans').select('id, name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, extra_professional_price_cents, sort_order').order('sort_order'),
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
  }
})

function eur(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
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

const monthlyEquivalentCents = computed(() => {
  const sub = subscription.value
  if (!sub?.plans) return 0
  const base = sub.billing_interval === 'annual' ? sub.plans.annual_price_cents : sub.plans.monthly_price_cents
  const overage = sub.extra_professionals > 0 ? sub.extra_professionals * (sub.plans.extra_professional_price_cents ?? 0) : 0
  return base + overage
})

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
  } catch (err: any) {
    planError.value = err?.data?.statusMessage ?? 'Could not update your plan. Please try again.'
  } finally {
    changingPlanId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-8">
    <h1 class="text-lg font-semibold text-ink-900">Subscription</h1>

    <div v-if="loading" class="mt-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-center justify-between">
        <UiSkeleton class="h-4 w-24 rounded-ctlSm" />
        <UiSkeleton class="h-6 w-20 rounded-full" />
      </div>
      <UiSkeleton class="h-3 w-full rounded-ctlSm" />
      <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
    </div>
    <div v-else-if="!subscription" class="mt-4 text-sm text-ink-muted">No subscription found. Contact <a :href="contactHref" class="text-brand hover:text-brand-hover">hola@columnaquiro.com</a>.</div>

    <template v-else>
      <p v-if="checkoutJustCompleted && !subscription.stripe_subscription_id" class="mt-4 rounded-card border border-line bg-brand-tint px-4 py-3 text-sm text-brand-text">
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
          <span v-if="subscription.extra_professionals > 0" class="text-ink-muted"> -- includes {{ subscription.extra_professionals }} extra professional(s)</span>
        </p>

        <p v-if="subscription.status === 'trialing' && store.trialDaysLeft !== null" class="text-sm text-ink-muted">
          {{ store.trialDaysLeft === 0 ? 'Your trial ends today.' : `${store.trialDaysLeft} day(s) left in your free trial.` }}
        </p>
        <p v-if="subscription.status === 'past_due'" class="text-sm text-danger-text">Your last payment failed. Update your payment method to avoid losing access.</p>
        <p v-if="subscription.status === 'locked' || subscription.status === 'canceled'" class="text-sm text-danger-text">This account is locked pending payment.</p>

        <div v-if="store.isOwner" class="pt-2">
          <UiBtn v-if="subscription.stripe_customer_id" variant="secondary" :disabled="loadingPortal" @click="openPortal(contactHref)">
            {{ loadingPortal ? 'Opening…' : 'Manage payment method & invoices' }}
          </UiBtn>
          <p v-else-if="subscription.comped" class="text-sm text-ink-muted">This account has complimentary access -- no billing to manage.</p>
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
            <UiBtn
              v-else
              variant="primary"
              :disabled="changingPlanId !== null"
              @click="choosePlan(plan)"
            >
              {{ changingPlanId === plan.id ? 'Please wait…' : subscription.stripe_subscription_id ? 'Switch to this plan' : 'Subscribe' }}
            </UiBtn>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
