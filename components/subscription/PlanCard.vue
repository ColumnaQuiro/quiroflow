<script setup lang="ts">
import { formatEur, formatLongDate, type SubscriptionState } from '~/utils/billing'

// The plan, and what it adds up to.
//
// "Change plan" is a primary button in this header rather than a section
// buried further down a tab called "Summary" -- one click from landing.
const props = defineProps<{
  planName: string
  description: string
  state: SubscriptionState
  lineItems: { key: string; label: string; amountCents: number }[]
  totalPerMonthCents: number
  interval: 'monthly' | 'annual'
  billingDay: number | null
  /** The other cadence, so the saving is visible without opening Change plan. */
  alternativePerMonthCents: number | null
  alternativeYearlyCents: number | null
  compedSince: string | null
  trialEndsAt: string | null
  canManage: boolean
}>()

defineEmits<{ changePlan: [] }>()

const t = useT()
const comped = computed(() => props.state === 'comped')
</script>

<template>
  <SubscriptionCard>
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-3">
      <div class="flex-1">
        <div class="flex items-center gap-2.5">
          <h2 class="text-[19px] font-semibold tracking-tightTitle text-ink-900">{{ planName }}</h2>
          <SubscriptionStatePill :state="state" />
        </div>
        <p class="mt-1.5 text-[13.5px] text-ink-muted">{{ description }}</p>
      </div>
      <button
        v-if="canManage && !comped"
        type="button"
        class="flex h-9 touch:h-11 items-center justify-center rounded-ctl bg-brand px-3.5 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus lg:h-[34px]"
        @click="$emit('changePlan')"
      >
        {{ t('Change plan', 'Cambiar de plan') }}
      </button>
    </div>

    <!-- Comped: no amounts anywhere. Not zeroes -- absence. -->
    <div v-if="comped" class="mt-4 border-t border-line-divider pt-4">
      <div class="flex items-start gap-2.5">
        <span class="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-success-border bg-success-bg">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-3 w-3 text-success-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <div>
          <p class="text-[14px] font-semibold text-ink-900">{{ t('Nothing is charged for this account', 'Esta cuenta no tiene ningún cargo') }}</p>
          <p class="mt-1.5 text-[12.5px] leading-[1.5] text-ink-muted">
            <template v-if="compedSince">
              {{ t('Complimentary access since', 'Acceso de cortesía desde el') }} {{ formatLongDate(compedSince) }}.
            </template>
            {{ t('It does not expire, and there is no card on file.', 'No caduca y no hay ninguna tarjeta guardada.') }}
          </p>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="mt-4 border-t border-line-divider pt-1">
        <div v-for="item in lineItems" :key="item.key" class="flex items-baseline gap-3 py-2.5">
          <span class="flex-1 text-[13.5px] text-ink-500">{{ item.label }}</span>
          <span class="font-mono text-[13.5px] font-medium text-ink-900">{{ formatEur(item.amountCents) }}</span>
          <span class="w-[92px] text-right text-[12px] text-ink-muted lg:w-[138px]">{{ t('/mo + IVA', '/mes + IVA') }}</span>
        </div>
        <div class="mt-1 flex items-baseline gap-3 border-t border-line pt-3">
          <span class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('Total per month', 'Total al mes') }}</span>
          <span class="font-mono text-[17px] font-semibold text-ink-900">{{ formatEur(totalPerMonthCents) }}</span>
          <span class="w-[92px] text-right text-[12px] text-ink-muted lg:w-[138px]">{{ t('/mo + IVA', '/mes + IVA') }}</span>
        </div>
      </div>

      <p v-if="state === 'trialing'" class="mt-3.5 border-t border-line-divider pt-3 text-[12.5px] leading-[1.5] text-ink-muted">
        {{ t('Charged so far', 'Cobrado hasta ahora') }} <strong class="font-semibold text-ink-700">{{ formatEur(0) }}</strong>.
        <template v-if="trialEndsAt">
          {{ t('Billing begins on', 'La facturación empieza el') }} {{ formatLongDate(trialEndsAt) }}.
        </template>
      </p>

      <p v-else-if="state === 'past_due'" class="mt-3.5 border-t border-line-divider pt-3 text-[12.5px] leading-[1.5] text-ink-muted">
        {{ t('Your plan, your calendar and your patient records are unchanged.', 'Tu plan, tu agenda y los historiales de tus pacientes siguen igual.') }}
      </p>

      <p
        v-else-if="billingDay || (interval === 'monthly' && alternativePerMonthCents && alternativeYearlyCents)"
        class="mt-3.5 border-t border-line-divider pt-3 text-[12.5px] leading-[1.5] text-ink-muted"
      >
        <!-- "day 21" rather than "the 21st": an English ordinal needs a
             suffix table to get 1st/2nd/3rd right, and Spanish takes none. -->
        <template v-if="billingDay">
          {{
            interval === 'annual'
              ? t(`Billed once a year on day ${billingDay}.`, `Se factura una vez al año, el día ${billingDay}.`)
              : t(`Billed monthly on day ${billingDay}.`, `Se factura cada mes, el día ${billingDay}.`)
          }}<template v-if="interval === 'monthly' && alternativePerMonthCents">&nbsp;</template>
        </template>
        <template v-if="interval === 'monthly' && alternativePerMonthCents && alternativeYearlyCents">
          {{ t('On annual it would be', 'En anual serían') }}
          <strong class="font-semibold text-ink-700">{{ formatEur(alternativePerMonthCents) }}{{ t('/mo', '/mes') }}</strong>
          — {{ t('one charge of', 'un cargo de') }} {{ formatEur(alternativeYearlyCents) }} {{ t('+ IVA a year.', '+ IVA al año.') }}
        </template>
      </p>
    </template>
  </SubscriptionCard>
</template>
