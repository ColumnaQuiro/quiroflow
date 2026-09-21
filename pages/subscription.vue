<script setup lang="ts">
import { planIncludesGrowth } from '~/utils/growthPlans'
import {
  bytesToGb,
  formatEur,
  formatLongDate,
  nextChargeTotal,
  pricePerMonth,
  seatAllowance,
  subscriptionState,
} from '~/utils/billing'
import type { PaymentEntry } from '~/components/subscription/PaymentsTable.vue'

// /subscription.
//
// This replaced a three-tab page capped at 768px whose most important fact --
// what Stripe is about to charge, and when -- was a run-on string in the page
// header, assembled by joining parts with five literal spaces.
//
// Two things drive the new shape. The rail carries the next payment and the
// card on every view, so that answer is never more than a glance away. And
// nothing on this page formats money or a date itself: utils/billing.ts owns
// both, which is what stopped es-ES amounts appearing inside en-US dates in
// the same sentence.

const SUPPORT_EMAIL = 'hola@quiroflow.com'

interface SubscriptionRow {
  status: string
  billing_interval: string
  extra_professionals: number
  growth_addon: boolean
  trial_ends_at: string | null
  comped: boolean
  created_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan_id: string
  plans: {
    name: string
    monthly_price_cents: number
    annual_price_cents: number
    included_professionals: number | null
    included_clinics: number | null
    included_storage_gb: number | null
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
  included_storage_gb: number | null
  extra_professional_price_cents: number | null
  sort_order: number
}

interface AddonRow {
  id: string
  name: string
  monthly_price_cents: number
  annual_price_cents: number
}

interface BillingInfo {
  hasCustomer: boolean
  name?: string | null
  email?: string | null
  country?: string | null
  taxId?: string | null
  address?: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null } | null
  card?: { brand: string; last4: string; expMonth: number; expYear: number } | null
  nextPaymentDate?: string | null
  upcoming?: { totalCents: number; subtotalCents: number; taxCents: number; currency: string } | null
}

const route = useRoute()
const router = useRouter()
const store = useAccountStore()
const supabase = useSupabaseClient()
const t = useT()
const { loading: loadingPortal, openPortal } = useBillingPortal()

const subscription = ref<SubscriptionRow | null>(null)
const plans = ref<PlanRow[]>([])
const growthAddon = ref<AddonRow | null>(null)
const practitioners = ref<{ full_name: string | null }[]>([])
const usage = ref<{ whatsapp_conversations_mtd: number; storage_bytes: number } | null>(null)
const billingInfo = ref<BillingInfo | null>(null)
const loading = ref(true)

const contactHref = computed(() => {
  const subject = encodeURIComponent(`Question about my QuiroFlow plan -- ${store.accountName}`)
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`
})

async function loadSubscription() {
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'status, billing_interval, extra_professionals, growth_addon, trial_ends_at, comped, created_at, stripe_customer_id, stripe_subscription_id, plan_id, plans(name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, included_storage_gb, extra_professional_price_cents)',
    )
    .eq('account_id', store.accountId!)
    .maybeSingle()
  subscription.value = data as SubscriptionRow | null
}

// Read through account_usage() rather than counting here: it is SECURITY
// DEFINER, so the figure is the same account-level truth for every team
// member instead of being filtered to whatever the reader can see.
async function loadUsage() {
  const { data } = await supabase.rpc('account_usage', { target_account_id: store.accountId! })
  usage.value = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
}

async function loadPractitioners() {
  const { data } = await supabase
    .from('team_members')
    .select('full_name')
    .eq('account_id', store.accountId!)
    .eq('is_practitioner', true)
    .is('deleted_at', null)
    .order('full_name')
  practitioners.value = data ?? []
}

async function loadBillingInfo() {
  if (!store.isOwner) return
  try {
    billingInfo.value = await $fetch<BillingInfo>('/api/billing/billing-info')
  } catch {
    billingInfo.value = { hasCustomer: false }
  }
}

// ---------------------------------------------------------------- derived

const state = computed(() =>
  subscription.value ? subscriptionState(subscription.value.status, subscription.value.comped) : 'locked',
)
const comped = computed(() => state.value === 'comped')
const interval = computed<'monthly' | 'annual'>(() =>
  subscription.value?.billing_interval === 'annual' ? 'annual' : 'monthly',
)
const currentPlanIncludesGrowth = computed(() => planIncludesGrowth(subscription.value?.plan_id))

/** Whether Growth is a billed line of its own, rather than bundled into the plan. */
const growthBilled = computed(() => !!subscription.value?.growth_addon && !currentPlanIncludesGrowth.value)

const shape = computed(() => ({
  interval: interval.value,
  extraProfessionals: subscription.value?.extra_professionals ?? 0,
  growthBilled: growthBilled.value,
}))

const planPricing = computed(() => {
  const p = subscription.value?.plans
  if (!p) return null
  return {
    monthlyPriceCents: p.monthly_price_cents,
    annualPriceCents: p.annual_price_cents,
    extraProfessionalPriceCents: p.extra_professional_price_cents,
  }
})

const addonPricing = computed(() =>
  growthAddon.value
    ? { monthlyPriceCents: growthAddon.value.monthly_price_cents, annualPriceCents: growthAddon.value.annual_price_cents }
    : null,
)

const perMonthCents = computed(() =>
  planPricing.value ? pricePerMonth(planPricing.value, shape.value, addonPricing.value) : 0,
)

// Stripe's own figure wherever it exists. The local computation is the
// fallback for an account with no readable customer, and it is flagged as an
// estimate when it is used -- never presented as the invoice.
const usingStripeAmount = computed(() => !!billingInfo.value?.upcoming)
const nextChargeCents = computed(() => {
  if (billingInfo.value?.upcoming) return billingInfo.value.upcoming.totalCents
  return planPricing.value ? nextChargeTotal(planPricing.value, shape.value, addonPricing.value) : null
})
const nextChargeSubtotal = computed(() => billingInfo.value?.upcoming?.subtotalCents ?? null)
const nextChargeTax = computed(() => billingInfo.value?.upcoming?.taxCents ?? null)

const planLineItems = computed(() => {
  const sub = subscription.value
  const plan = sub?.plans
  if (!sub || !plan) return []
  const annual = interval.value === 'annual'
  const items = [
    {
      key: 'plan',
      label: t(`${plan.name} plan`, `Plan ${plan.name}`),
      amountCents: annual ? plan.annual_price_cents : plan.monthly_price_cents,
    },
  ]
  if (sub.extra_professionals > 0 && plan.extra_professional_price_cents) {
    items.push({
      key: 'seats',
      label: t(
        `${sub.extra_professionals} extra practitioner seat(s)`,
        `${sub.extra_professionals} plaza(s) de profesional extra`,
      ),
      amountCents: sub.extra_professionals * plan.extra_professional_price_cents,
    })
  }
  if (growthBilled.value && growthAddon.value) {
    items.push({
      key: 'growth',
      label: t('Growth add-on', 'Complemento Growth'),
      amountCents: annual ? growthAddon.value.annual_price_cents : growthAddon.value.monthly_price_cents,
    })
  }
  return items
})

const seatCeiling = computed(() =>
  seatAllowance(subscription.value?.plans?.included_professionals, subscription.value?.extra_professionals ?? 0, comped.value),
)

const billingDay = computed(() => {
  const iso = billingInfo.value?.nextPaymentDate
  return iso ? new Date(iso).getDate() : null
})

const alternativePerMonth = computed(() => {
  const plan = subscription.value?.plans
  if (!plan || interval.value === 'annual') return null
  return plan.annual_price_cents
})
const alternativeYearly = computed(() => (alternativePerMonth.value === null ? null : alternativePerMonth.value * 12))

// ------------------------------------------------------------------ views

type View = 'plan' | 'billing' | 'payments'
const view = ref<View>('plan')
const changingPlan = ref(false)

// A comped account has no bill, so the two billing views have nothing to
// show. The control renders "Plan" alone rather than offering two dead tabs.
const views = computed(() =>
  comped.value
    ? [{ key: 'plan', label: t('Plan', 'Plan') }]
    : [
        { key: 'plan', label: t('Plan', 'Plan') },
        { key: 'billing', label: t('Billing', 'Facturación') },
        { key: 'payments', label: t('Payments', 'Pagos') },
      ],
)

watch(view, (value) => {
  if (value === 'payments') loadPayments()
})

// ---------------------------------------------------------------- payments

const payments = ref<PaymentEntry[]>([])
const loadingPayments = ref(false)
const paymentsLoaded = ref(false)
async function loadPayments() {
  if (paymentsLoaded.value || !store.isOwner) return
  loadingPayments.value = true
  try {
    const result = await $fetch<{ payments: PaymentEntry[] }>('/api/billing/payments')
    payments.value = result.payments
    paymentsLoaded.value = true
  } finally {
    loadingPayments.value = false
  }
}

const recentPayments = computed(() => payments.value.slice(0, 3))

// -------------------------------------------------------- post-checkout poll

const MAX_ATTEMPTS = 20
const activating = ref(false)
const attempt = ref(0)
const secondsToNext = ref(3)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

function stopPolling() {
  clearTimeout(pollTimer)
  clearInterval(tickTimer)
  activating.value = false
}

// Backoff, capped: a webhook that never arrives must not leave the tab
// hammering the API forever. When the attempts run out the copy falls back to
// "we'll email you", which is what actually happens.
async function pollForActivation() {
  if (attempt.value >= MAX_ATTEMPTS) {
    stopPolling()
    return
  }
  attempt.value += 1
  await loadSubscription()
  if (subscription.value?.stripe_subscription_id) {
    await loadBillingInfo()
    stopPolling()
    router.replace({ query: {} })
    return
  }
  const delay = Math.min(15, 2 + attempt.value)
  secondsToNext.value = delay
  clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    if (secondsToNext.value > 0) secondsToNext.value -= 1
  }, 1000)
  pollTimer = setTimeout(pollForActivation, delay * 1000)
}

function refreshNow() {
  clearTimeout(pollTimer)
  clearInterval(tickTimer)
  pollForActivation()
}

onBeforeUnmount(stopPolling)

onMounted(async () => {
  const [, { data: planRows }, { data: addonRows }] = await Promise.all([
    loadSubscription(),
    supabase
      .from('plans')
      .select(
        'id, name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, included_storage_gb, extra_professional_price_cents, sort_order',
      )
      .order('sort_order'),
    supabase.from('addons').select('id, name, monthly_price_cents, annual_price_cents'),
    loadPractitioners(),
    loadUsage(),
    loadBillingInfo(),
  ])
  plans.value = planRows ?? []
  growthAddon.value = (addonRows ?? []).find((a) => a.id === 'growth') ?? null
  loading.value = false

  if (route.query.checkout === 'success' && !subscription.value?.stripe_subscription_id) {
    activating.value = true
    pollForActivation()
  }
})

// The change is applied by Stripe in place (subscribe.post.ts updates the
// subscription with create_prorations), so the row here is stale until the
// webhook lands. Re-reading both is cheaper than guessing what changed.
async function onPlanChanged() {
  changingPlan.value = false
  loading.value = true
  await Promise.all([loadSubscription(), loadBillingInfo()])
  paymentsLoaded.value = false
  loading.value = false
}

function openStripePortal() {
  openPortal(contactHref.value)
}
function openStripeCancel() {
  openPortal(contactHref.value, 'cancel')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="t('Subscription', 'Suscripción')"
      :meta="
        store.accountName +
        (store.teamMember?.full_name ? ` · ${t('Owner', 'Propietario')}: ${store.teamMember.full_name}` : '') +
        (subscription?.created_at ? ` · ${t('Customer since', 'Cliente desde')} ${formatLongDate(subscription.created_at)}` : '')
      "
    />

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-7 pt-4 lg:px-8 lg:pt-6">
      <!-- Not the permission: /api/billing/* refuses a non-owner server-side.
           This is the courtesy that explains why the page is empty. -->
      <SubscriptionNonOwnerNotice
        v-if="!store.isOwner"
        :owner-name="null"
        :support-email="SUPPORT_EMAIL"
        class="mx-auto max-w-[620px]"
      />

      <SubscriptionLoadingSkeleton v-else-if="loading" />

      <div v-else-if="!subscription" class="text-[13px] text-ink-muted">
        {{ t('No subscription found. Contact', 'No se ha encontrado ninguna suscripción. Escríbenos a') }}
        <a :href="contactHref" class="font-semibold text-brand-text hover:text-brand-hover">{{ SUPPORT_EMAIL }}</a>.
      </div>

      <template v-else>
        <div class="mt-1">
          <SubscriptionSegmentedControl v-model="view" :items="views" />
        </div>

        <SubscriptionActivatingCard
          v-if="activating"
          class="mt-4"
          :amount-cents="nextChargeCents"
          :attempt="attempt"
          :max-attempts="MAX_ATTEMPTS"
          :seconds-to-next="secondsToNext"
          :support-email="SUPPORT_EMAIL"
          @refresh="refreshNow"
        />

        <!-- ======================= CHANGE PLAN ========================= -->
        <!-- Its own screen rather than a section below the fold: it is the
             action the summary's primary button exists to reach. Full width,
             because the three plan cards and the footer summary need it. -->
        <SubscriptionChangePlanPanel
          v-if="view === 'plan' && changingPlan"
          class="mt-4"
          :plans="plans"
          :current-plan-id="subscription.plan_id"
          :current-interval="interval"
          :current-extra-seats="subscription.extra_professionals"
          :current-growth="!!subscription.growth_addon"
          :growth-addon="growthAddon"
          :card="billingInfo?.card ?? null"
          :renewal-date="billingInfo?.nextPaymentDate ?? null"
          @back="changingPlan = false"
          @changed="onPlanChanged"
        />

        <!-- ============================ PLAN ============================ -->
        <div v-else-if="view === 'plan'" class="mt-4 flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div class="flex min-w-0 flex-1 flex-col gap-4 lg:max-w-[756px]">
            <SubscriptionTrialBanner
              v-if="state === 'trialing' && store.trialDaysLeft !== null"
              :days-left="store.trialDaysLeft"
              :total-days="30"
              :ends-at="subscription.trial_ends_at"
              @add-card="openStripePortal"
              @compare-plans="changingPlan = true"
            />

            <SubscriptionFailedBanner
              v-else-if="state === 'past_due'"
              :amount-cents="nextChargeCents"
              :attempted-on="billingInfo?.nextPaymentDate ?? null"
              :card="billingInfo?.card ?? null"
              :decline-reason="t('The card was declined by the bank.', 'El banco rechazó la tarjeta.')"
              :retry-dates="[]"
              :lock-date="null"
              :invoice-url="null"
              @update-card="openStripePortal"
            />

            <SubscriptionPlanCard
              :plan-name="subscription.plans?.name ?? t('Plan', 'Plan')"
              :description="
                t(
                  'Everything your practice runs on — calendar, patient records, reminders and invoicing.',
                  'Todo lo que hace funcionar tu consulta: agenda, historiales, recordatorios y facturación.',
                )
              "
              :state="state"
              :line-items="planLineItems"
              :total-per-month-cents="perMonthCents"
              :interval="interval"
              :billing-day="billingDay"
              :alternative-per-month-cents="alternativePerMonth"
              :alternative-yearly-cents="alternativeYearly"
              :comped-since="subscription.created_at"
              :trial-ends-at="subscription.trial_ends_at"
              :can-manage="store.isOwner"
              @change-plan="changingPlan = true"
            />

            <SubscriptionUsageCard
              :practitioner-count="practitioners.length"
              :seat-allowance="seatCeiling"
              :practitioner-names="practitioners.map((p) => p.full_name ?? '').filter(Boolean).slice(0, 3)"
              :extra-seat-price-cents="subscription.plans?.extra_professional_price_cents ?? null"
              :storage-gb="bytesToGb(usage?.storage_bytes ?? 0)"
              :storage-allowance-gb="comped ? null : (subscription.plans?.included_storage_gb ?? null)"
              :clinic-count="store.clinics.length"
              :clinic-allowance="comped ? null : (subscription.plans?.included_clinics ?? null)"
              :clinic-names="store.clinics.map((c) => c.name)"
              :comped="comped"
            />

            <SubscriptionCard v-if="!comped">
              <div class="flex items-center gap-2.5">
                <h3 class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('Recent payments', 'Pagos recientes') }}</h3>
                <button
                  type="button"
                  class="text-[12.5px] font-semibold text-brand-text hover:text-brand-hover"
                  @click="view = 'payments'"
                >
                  {{ t('View all payments', 'Ver todos los pagos') }}
                </button>
              </div>
              <div v-if="recentPayments.length" class="mt-1.5">
                <div
                  v-for="payment in recentPayments"
                  :key="payment.saleId"
                  class="flex items-center gap-3 border-b border-line-divider py-2.5 last:border-0"
                >
                  <span class="w-[120px] shrink-0 text-[12.5px] text-ink-muted lg:w-[178px]">{{ formatLongDate(payment.date) }}</span>
                  <span class="min-w-0 flex-1 truncate text-[13.5px] text-ink-700">{{ payment.product }}</span>
                  <span class="font-mono text-[13px] font-medium text-ink-900">{{ formatEur(payment.transactionAmountCents) }}</span>
                </div>
              </div>
              <p v-else class="mt-2.5 text-[12.5px] text-ink-muted">
                {{ t('No payments yet.', 'Todavía no hay pagos.') }}
                <template v-if="subscription.trial_ends_at">
                  {{ t('The first lands on', 'El primero será el') }} {{ formatLongDate(subscription.trial_ends_at) }}.
                </template>
              </p>
            </SubscriptionCard>
          </div>

          <!-- The rail. Present on Plan and Billing so the next payment is
               never more than a glance away; Payments drops it for width. -->
          <div v-if="!comped" class="flex flex-col gap-4 lg:w-[356px] lg:shrink-0">
            <SubscriptionNextPaymentCard
              :variant="state === 'past_due' ? 'past_due' : state === 'trialing' ? 'trial' : 'active'"
              :total-cents="nextChargeCents"
              :subtotal-cents="nextChargeSubtotal"
              :tax-cents="nextChargeTax"
              :date="billingInfo?.nextPaymentDate ?? subscription.trial_ends_at"
              :card="billingInfo?.card ?? null"
              :estimated="!usingStripeAmount"
              @portal="openStripePortal"
            />
            <SubscriptionPaymentMethodCard
              v-if="state !== 'trialing' || billingInfo?.card"
              :card="billingInfo?.card ?? null"
              :holder="billingInfo?.name ?? null"
              @portal="openStripePortal"
            />
            <SubscriptionHelpCard :email="SUPPORT_EMAIL" />
          </div>
        </div>

        <!-- =========================== BILLING =========================== -->
        <div v-else-if="view === 'billing'" class="mt-4 flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div class="flex min-w-0 flex-1 flex-col gap-4 lg:max-w-[756px]">
            <div v-if="!billingInfo?.hasCustomer" class="rounded-card border border-line bg-surface p-[18px] text-[13px] text-ink-muted shadow-card">
              {{ t('No billing details yet — start a subscription first.', 'Todavía no hay datos de facturación: primero inicia una suscripción.') }}
            </div>
            <template v-else>
              <SubscriptionBillingRecord
                :account-name="store.accountName"
                :owner-name="store.teamMember?.full_name ?? null"
                :billing-email="billingInfo?.email ?? null"
                :country="billingInfo?.country ?? null"
                :tax-id="billingInfo?.taxId ?? null"
                :address="billingInfo?.address ?? null"
                :card="billingInfo?.card ?? null"
                @portal="openStripePortal"
              />
            </template>
            <!-- Keyed off our OWN subscription row, not off billing-info.
                 Reading the Stripe customer can fail (rate limit, outage, a
                 key that is not configured in an environment) and an owner
                 who cannot reach "Cancel subscription" because of that has no
                 way out of a plan they are paying for. -->
            <SubscriptionStripeHandoffCard
              v-if="subscription.stripe_subscription_id"
              :customer-since="subscription.created_at"
              :access-ends-at="billingInfo?.nextPaymentDate ?? null"
              @portal="openStripePortal"
              @cancel="openStripeCancel"
            />
          </div>
          <div class="flex flex-col gap-4 lg:w-[356px] lg:shrink-0">
            <SubscriptionNextPaymentCard
              :variant="state === 'past_due' ? 'past_due' : state === 'trialing' ? 'trial' : 'active'"
              :total-cents="nextChargeCents"
              :subtotal-cents="nextChargeSubtotal"
              :tax-cents="nextChargeTax"
              :date="billingInfo?.nextPaymentDate ?? subscription.trial_ends_at"
              :card="billingInfo?.card ?? null"
              :estimated="!usingStripeAmount"
              @portal="openStripePortal"
            />
            <SubscriptionHelpCard :email="SUPPORT_EMAIL" />
          </div>
        </div>

        <!-- ========================== PAYMENTS ========================== -->
        <div v-else class="mt-4 flex flex-col gap-4">
          <!-- No rail here: the table takes the full width, so the same facts
               become a strip above it rather than disappearing. -->
          <SubscriptionCard>
            <div class="flex flex-wrap items-center gap-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-brand-tintBorder bg-brand-tint">
                <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-brand-text">
                  <rect x="2.6" y="3.8" width="12.8" height="11" rx="2.2" stroke="currentColor" stroke-width="1.4" />
                  <path d="M2.6 7.2H15.4" stroke="currentColor" stroke-width="1.4" />
                </svg>
              </span>
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Next payment', 'Próximo pago') }}</span>
              <span class="font-mono text-[17px] font-semibold text-ink-900">{{ nextChargeCents === null ? '—' : formatEur(nextChargeCents) }}</span>
              <span class="text-[13px] text-ink-500">
                <template v-if="billingInfo?.nextPaymentDate">{{ t('on', 'el') }} {{ formatLongDate(billingInfo.nextPaymentDate) }}</template>
                <template v-if="nextChargeSubtotal !== null && nextChargeTax"> · {{ formatEur(nextChargeSubtotal) }} + {{ formatEur(nextChargeTax) }} IVA</template>
                <template v-if="billingInfo?.card"> · {{ billingInfo.card.brand }} ·· {{ billingInfo.card.last4 }}</template>
              </span>
              <span class="flex-1" />
              <SubscriptionOutboundLink as="button" @click="openStripePortal">
                {{ t('View upcoming invoice in Stripe', 'Ver la próxima factura en Stripe') }}
              </SubscriptionOutboundLink>
            </div>
          </SubscriptionCard>

          <SubscriptionPaymentsTable
            :payments="payments"
            :loading="loadingPayments"
            :first-charge-date="subscription.trial_ends_at"
            @download-all="openStripePortal"
          />
        </div>
      </template>
    </div>
  </div>
</template>
