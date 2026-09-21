<script setup lang="ts">
import { MONTHS_PER_YEAR, formatEur, formatLongDate } from '~/utils/billing'
import { planIncludesGrowth } from '~/utils/growthPlans'

export interface ChangePlanRow {
  id: string
  name: string
  monthly_price_cents: number
  annual_price_cents: number
  included_professionals: number | null
  included_clinics: number | null
  included_storage_gb: number | null
  extra_professional_price_cents: number | null
}

const props = defineProps<{
  plans: ChangePlanRow[]
  currentPlanId: string
  currentInterval: 'monthly' | 'annual'
  currentExtraSeats: number
  currentGrowth: boolean
  growthAddon: { monthly_price_cents: number; annual_price_cents: number } | null
  card: { brand: string; last4: string } | null
  renewalDate: string | null
}>()

const emit = defineEmits<{ back: [], changed: [] }>()

const t = useT()

const interval = ref<'monthly' | 'annual'>(props.currentInterval)
const extraSeats = ref(props.currentExtraSeats)
const wantsGrowth = ref(props.currentGrowth)
const selectedPlanId = ref(props.currentPlanId)

const selectedPlan = computed(() => props.plans.find((p) => p.id === selectedPlanId.value) ?? null)
const selectedIncludesGrowth = computed(() => planIncludesGrowth(selectedPlanId.value))

// Clinic bundles Growth, so a clinic on it is never quoted a price for it --
// there is no Stripe line item to quote.
const growthChargeable = computed(() => wantsGrowth.value && !selectedIncludesGrowth.value)

const perMonthCents = computed(() => {
  const plan = selectedPlan.value
  if (!plan) return 0
  const annual = interval.value === 'annual'
  const base = annual ? plan.annual_price_cents : plan.monthly_price_cents
  const seats = extraSeats.value * (plan.extra_professional_price_cents ?? 0)
  const growth =
    growthChargeable.value && props.growthAddon
      ? annual
        ? props.growthAddon.annual_price_cents
        : props.growthAddon.monthly_price_cents
      : 0
  return base + seats + growth
})

const chargeCents = computed(() =>
  interval.value === 'annual' ? perMonthCents.value * MONTHS_PER_YEAR : perMonthCents.value,
)

function featuresFor(plan: ChangePlanRow) {
  const includesGrowth = planIncludesGrowth(plan.id)
  const seats =
    plan.included_professionals === null
      ? t('Unlimited practitioner seats', 'Plazas de profesional ilimitadas')
      : t(`${plan.included_professionals} practitioner seats`, `${plan.included_professionals} plazas de profesional`)
  const clinics =
    plan.included_clinics === null
      ? t('Unlimited clinics', 'Clínicas ilimitadas')
      : t(`${plan.included_clinics} clinic`, `${plan.included_clinics} clínica`)
  const features: { key: string; label: string; muted?: boolean }[] = [
    { key: 'seats', label: seats },
    { key: 'extra', label: t(`Extra seats ${formatEur(plan.extra_professional_price_cents ?? 0)}/mo each`, `Plazas extra ${formatEur(plan.extra_professional_price_cents ?? 0)}/mes cada una`) },
    { key: 'clinics', label: clinics },
    { key: 'storage', label: t(`${plan.included_storage_gb ?? 0} GB of patient files`, `${plan.included_storage_gb ?? 0} GB de archivos de pacientes`) },
  ]
  features.push(
    includesGrowth
      ? { key: 'growth', label: t('Growth add-on included', 'Complemento Growth incluido') }
      : {
          key: 'growth',
          label: t(
            `Growth add-on ${formatEur(interval.value === 'annual' ? (props.growthAddon?.annual_price_cents ?? 0) : (props.growthAddon?.monthly_price_cents ?? 0))}/mo extra`,
            `Complemento Growth ${formatEur(interval.value === 'annual' ? (props.growthAddon?.annual_price_cents ?? 0) : (props.growthAddon?.monthly_price_cents ?? 0))}/mes aparte`,
          ),
          muted: true,
        },
  )
  return features
}

// ------------------------------------------------------------- proration

const previewFor = ref<string | null>(null)
const previewCents = ref<number | null>(null)
const previewError = ref('')
const previewing = ref(false)

// Always Stripe's number. A proration computed here would be wrong the moment
// a credit, a coupon or a mid-period change is involved.
async function preview(planId: string) {
  previewFor.value = planId
  previewCents.value = null
  previewError.value = ''
  previewing.value = true
  try {
    const result = await $fetch<{ previewable: boolean; amountDueCents?: number }>('/api/billing/preview', {
      method: 'POST',
      body: { planId, interval: interval.value, extraProfessionals: extraSeats.value, growth: growthChargeable.value },
    })
    previewCents.value = result.previewable ? (result.amountDueCents ?? null) : null
  } catch (error: unknown) {
    previewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    previewing.value = false
  }
}

function choose(planId: string) {
  selectedPlanId.value = planId
  if (planId !== props.currentPlanId) preview(planId)
}

// Re-previewing on every knob turn would be a request per keystroke of the
// stepper; the footer's own confirm re-checks against Stripe anyway.
watch([interval, extraSeats, wantsGrowth], () => {
  previewCents.value = null
  previewFor.value = null
})

// ------------------------------------------------------------- confirming

const confirming = ref(false)
const confirmError = ref('')

async function confirm() {
  if (confirming.value) return
  confirming.value = true
  confirmError.value = ''
  try {
    const result = await $fetch<{ url?: string; updated?: boolean }>('/api/billing/subscribe', {
      method: 'POST',
      body: {
        planId: selectedPlanId.value,
        interval: interval.value,
        extraProfessionals: extraSeats.value,
        growth: growthChargeable.value,
      },
    })
    // An account with no subscription yet goes through Checkout; one with a
    // card on file is updated in place. Both paths already existed.
    if (result.url) {
      window.location.href = result.url
      return
    }
    emit('changed')
  } catch (error: unknown) {
    confirmError.value = error instanceof Error ? error.message : String(error)
  } finally {
    confirming.value = false
  }
}

const summary = computed(() => {
  const parts = [selectedPlan.value?.name ?? '', interval.value === 'annual' ? t('annual', 'anual') : t('monthly', 'mensual')]
  if (extraSeats.value > 0) {
    parts.push(t(`${extraSeats.value} extra seat(s)`, `${extraSeats.value} plaza(s) extra`))
  }
  if (growthChargeable.value) parts.push(t('Growth add-on', 'complemento Growth'))
  return parts.filter(Boolean).join(' · ')
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
      <div class="flex-1">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted outline-none hover:text-ink-700 focus-visible:text-ink-700"
          @click="emit('back')"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
            <path d="M9.5 4L5.5 8L9.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ t('Back to subscription', 'Volver a la suscripción') }}
        </button>
        <h2 class="mt-2 text-[18px] font-semibold tracking-tightTitle text-ink-900">{{ t('Change plan', 'Cambiar de plan') }}</h2>
      </div>
      <div class="flex items-center gap-2.5">
        <SubscriptionSegmentedControl
          v-model="interval"
          :items="[
            { key: 'monthly', label: t('Monthly', 'Mensual') },
            { key: 'annual', label: t('Annual', 'Anual') },
          ]"
        />
        <SubscriptionPill tone="success">{{ t('Save about 10 %', 'Ahorra un 10 %') }}</SubscriptionPill>
      </div>
    </div>

    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      <SubscriptionPlanOption
        v-for="plan in plans"
        :key="plan.id"
        :name="plan.name"
        :description="
          plan.included_clinics === null
            ? t('Several clinics, unlimited team.', 'Varias clínicas, equipo ilimitado.')
            : plan.included_professionals === 1
              ? t('One practitioner, one clinic.', 'Un profesional, una clínica.')
              : t('A single clinic with a small team.', 'Una clínica con un equipo pequeño.')
        "
        :interval="interval"
        :monthly-price-cents="plan.monthly_price_cents"
        :annual-price-cents="plan.annual_price_cents"
        :features="featuresFor(plan)"
        :current="plan.id === currentPlanId"
        :proration-cents="previewFor === plan.id ? previewCents : null"
        :proration-note="
          previewFor === plan.id && renewalDate
            ? t(`Then every ${formatLongDate(renewalDate)}.`, `Después, cada ${formatLongDate(renewalDate)}.`)
            : null
        "
        :busy="previewing && previewFor === plan.id"
        @choose="choose(plan.id)"
      />
    </div>

    <SubscriptionCard>
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-5">
        <div class="flex-1">
          <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Practitioner seats', 'Plazas de profesional') }}</h3>
          <p class="mt-1.5 text-[12.5px] leading-[1.5] text-ink-muted">
            <template v-if="selectedPlan?.included_professionals !== null && selectedPlan">
              {{ t(`${selectedPlan.name} includes ${selectedPlan.included_professionals}.`, `${selectedPlan.name} incluye ${selectedPlan.included_professionals}.`) }}
              {{ t('Extra seats are', 'Las plazas extra cuestan') }} {{ formatEur(selectedPlan.extra_professional_price_cents ?? 0) }}{{ t('/mo + IVA each.', '/mes + IVA cada una.') }}
            </template>
            {{
              t(
                'Front desk, practice managers and bookkeepers never use a seat — invite as many as you like.',
                'Recepción, gerencia y contabilidad nunca ocupan plaza: invita a quien quieras.',
              )
            }}
          </p>
        </div>
        <div class="flex items-center gap-3.5">
          <SubscriptionSeatStepper v-model="extraSeats" :min="0" :max="50" />
          <div class="w-[152px]">
            <div class="text-[12.5px] font-semibold text-ink-900">
              {{ extraSeats === 0 ? t('No extra seats', 'Sin plazas extra') : t(`+${extraSeats} extra seat(s)`, `+${extraSeats} plaza(s) extra`) }}
            </div>
            <div v-if="extraSeats > 0 && selectedPlan" class="mt-0.5 font-mono text-[12.5px] text-ink-muted">
              {{ formatEur(extraSeats * (selectedPlan.extra_professional_price_cents ?? 0)) }}{{ t('/mo + IVA', '/mes + IVA') }}
            </div>
          </div>
        </div>
      </div>
    </SubscriptionCard>

    <SubscriptionCard>
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-5">
        <div class="flex-1">
          <div class="flex items-center gap-2.5">
            <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Growth add-on', 'Complemento Growth') }}</h3>
            <SubscriptionPill v-if="selectedIncludesGrowth" tone="success">{{ t('Included', 'Incluido') }}</SubscriptionPill>
            <SubscriptionPill v-else-if="wantsGrowth" tone="success">{{ t('On', 'Activo') }}</SubscriptionPill>
          </div>
          <p class="mt-1.5 text-[12.5px] leading-[1.5] text-ink-muted">
            {{
              t(
                'Automated recalls for patients who stopped coming, review requests after a visit, and the monthly referral report.',
                'Recordatorios automáticos para pacientes que dejaron de venir, solicitudes de reseña tras la visita y el informe mensual de referencias.',
              )
            }}
            <template v-if="selectedIncludesGrowth">
              {{ t('Included at no cost on this plan.', 'Incluido sin coste en este plan.') }}
            </template>
          </p>
        </div>
        <div class="flex items-center gap-3.5">
          <div v-if="!selectedIncludesGrowth && growthAddon" class="w-[152px] text-right">
            <div class="font-mono text-[13.5px] font-semibold text-ink-900">
              {{ formatEur(interval === 'annual' ? growthAddon.annual_price_cents : growthAddon.monthly_price_cents) }}{{ t('/mo + IVA', '/mes + IVA') }}
            </div>
            <div class="mt-0.5 text-[12px] text-ink-muted">
              {{ interval === 'annual' ? t('billed annually', 'facturado anualmente') : t('billed monthly', 'facturado mensualmente') }}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="selectedIncludesGrowth || wantsGrowth"
            :aria-label="t('Growth add-on', 'Complemento Growth')"
            :disabled="selectedIncludesGrowth"
            class="flex h-[26px] w-11 shrink-0 items-center rounded-pill border p-[3px] outline-none focus-visible:shadow-focus disabled:opacity-60"
            :class="selectedIncludesGrowth || wantsGrowth ? 'justify-end border-brand bg-brand' : 'justify-start border-line-control bg-toggle-off'"
            @click="wantsGrowth = !wantsGrowth"
          >
            <span class="block h-5 w-5 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </SubscriptionCard>

    <SubscriptionCard tone="subtle">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-5">
        <div class="flex-1">
          <p class="text-[13.5px] font-semibold text-ink-900">{{ summary }}</p>
          <p class="mt-1.5 text-[12.5px] text-ink-muted">
            <template v-if="card">{{ t('Charged to', 'Se cobra a') }} {{ card.brand }} ·· {{ card.last4 }}. </template>
            {{ t('Cancel or change the card in Stripe — we never hold it here.', 'Cancela o cambia la tarjeta en Stripe: aquí nunca la guardamos.') }}
          </p>
          <p v-if="confirmError" role="alert" class="mt-1.5 text-[12.5px] text-danger-text">{{ confirmError }}</p>
        </div>
        <div class="text-right">
          <div class="font-mono text-[19px] font-semibold text-ink-900">{{ formatEur(chargeCents) }} + IVA</div>
          <div class="mt-0.5 text-[12px] text-ink-muted">
            {{
              interval === 'annual'
                ? t(`once a year · ${formatEur(perMonthCents)}/mo`, `una vez al año · ${formatEur(perMonthCents)}/mes`)
                : t('every month', 'cada mes')
            }}
          </div>
        </div>
        <button
          type="button"
          :disabled="confirming"
          class="flex h-12 items-center justify-center rounded-ctl bg-brand px-4 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus disabled:cursor-wait lg:h-10"
          @click="confirm"
        >
          {{ confirming ? t('Working…', 'Procesando…') : t('Confirm change', 'Confirmar cambio') }}
        </button>
      </div>
    </SubscriptionCard>
  </div>
</template>
