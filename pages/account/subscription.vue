<script setup lang="ts">
interface SubscriptionRow {
  status: string
  billing_interval: string
  extra_professionals: number
  trial_ends_at: string | null
  comped: boolean
  stripe_customer_id: string | null
  plans: {
    name: string
    monthly_price_cents: number
    annual_price_cents: number
    included_professionals: number | null
    extra_professional_price_cents: number | null
  } | null
}

const store = useAccountStore()
const supabase = useSupabaseClient()
const { loading: loadingPortal, openPortal } = useBillingPortal()

const subscription = ref<SubscriptionRow | null>(null)
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'status, billing_interval, extra_professionals, trial_ends_at, comped, stripe_customer_id, plans(name, monthly_price_cents, annual_price_cents, included_professionals, extra_professional_price_cents)',
    )
    .eq('account_id', store.accountId!)
    .maybeSingle()
  subscription.value = data as SubscriptionRow | null
  loading.value = false
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
</script>

<template>
  <div class="mx-auto max-w-xl px-6 py-8">
    <h1 class="text-lg font-semibold text-ink-900">Subscription</h1>

    <div v-if="loading" class="mt-4 text-sm text-ink-muted">Loading…</div>
    <div v-else-if="!subscription" class="mt-4 text-sm text-ink-muted">No subscription found. Contact <a :href="contactHref" class="text-brand hover:text-brand-hover">hola@columnaquiro.com</a>.</div>

    <div v-else class="mt-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
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
          {{ loadingPortal ? 'Opening…' : 'Manage billing' }}
        </UiBtn>
        <p v-else class="text-sm text-ink-muted">
          Nothing to manage yet while on the free trial. Ready to subscribe? Contact <a :href="contactHref" class="text-brand hover:text-brand-hover">hola@columnaquiro.com</a>.
        </p>
      </div>
    </div>
  </div>
</template>
