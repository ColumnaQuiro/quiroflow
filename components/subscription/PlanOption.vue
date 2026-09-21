<script setup lang="ts">
import { MONTHS_PER_YEAR, formatEur } from '~/utils/billing'

// One plan on the Change plan screen.
//
// The bordered strip carrying the once-a-year charge is the anti-bug element:
// a card that shows only "89,00 €/mo" is how an annual customer comes to
// believe that is what will leave their account.
const props = defineProps<{
  name: string
  description: string
  interval: 'monthly' | 'annual'
  monthlyPriceCents: number
  annualPriceCents: number
  features: { key: string; label: string; muted?: boolean }[]
  current: boolean
  /** Stripe's real proration for switching to this plan, in cents, or null. */
  prorationCents?: number | null
  prorationNote?: string | null
  busy?: boolean
}>()

defineEmits<{ choose: [] }>()

const t = useT()

const perMonthCents = computed(() => (props.interval === 'annual' ? props.annualPriceCents : props.monthlyPriceCents))
const yearlyCents = computed(() => props.annualPriceCents * MONTHS_PER_YEAR)
</script>

<template>
  <div
    class="flex flex-col rounded-card border p-[18px]"
    :class="current ? 'border-brand shadow-[0_0_0_3px_rgb(var(--color-brand)/0.10)]' : 'border-line bg-surface shadow-card'"
  >
    <div class="flex items-center gap-2.5">
      <h3 class="text-[16px] font-semibold text-ink-900">{{ name }}</h3>
      <SubscriptionPill v-if="current" tone="brand" class="ml-auto">{{ t('Current plan', 'Plan actual') }}</SubscriptionPill>
    </div>
    <p class="mt-1.5 text-[12.5px] leading-[1.45] text-ink-muted">{{ description }}</p>

    <div class="mt-3.5 flex items-baseline gap-1.5">
      <span class="text-[26px] font-semibold tracking-tightTitle text-ink-900">{{ formatEur(perMonthCents) }}</span>
      <span class="text-[12.5px] text-ink-muted">{{ t('/mo + IVA', '/mes + IVA') }}</span>
    </div>
    <p class="mt-1.5 text-[12px] text-ink-muted">
      <template v-if="interval === 'annual'">
        {{ t('billed annually ·', 'facturado anualmente ·') }} {{ formatEur(monthlyPriceCents) }} {{ t('/mo if you pay monthly', '/mes si pagas mensualmente') }}
      </template>
      <template v-else>
        {{ formatEur(annualPriceCents) }} {{ t('/mo if you pay annually', '/mes si pagas anualmente') }}
      </template>
    </p>

    <!-- Keep this strip. It is the only place the yearly number appears next
         to the per-month one, which is what stops them being confused. -->
    <div class="mt-3 rounded-ctl border border-line bg-surface-subtle px-3 py-2.5">
      <!-- On monthly this is what annual WOULD cost, not what we will take.
           Saying "we charge 528,00 € once a year" to someone paying monthly
           is the same class of mistake this strip exists to prevent. -->
      <span class="text-[12.5px] text-ink-700">
        <template v-if="interval === 'annual'">
          {{ t('We charge', 'Cobramos') }} <strong class="font-mono font-semibold">{{ formatEur(yearlyCents) }}</strong>
          {{ t('+ IVA once a year', '+ IVA una vez al año') }}
        </template>
        <template v-else>
          {{ t('On annual,', 'En anual,') }} <strong class="font-mono font-semibold">{{ formatEur(yearlyCents) }}</strong>
          {{ t('+ IVA once a year', '+ IVA una vez al año') }}
        </template>
      </span>
    </div>

    <div class="mt-3.5 border-t border-line-divider pt-3">
      <div v-for="feature in features" :key="feature.key" class="flex items-start gap-2 py-1.5">
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="mt-[3px] h-3 w-3 shrink-0 text-success-text">
          <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="text-[12.5px] leading-[1.45]" :class="feature.muted ? 'text-ink-muted' : 'text-ink-700'">{{ feature.label }}</span>
      </div>
    </div>

    <div v-if="prorationCents !== null && prorationCents !== undefined" class="mt-3 rounded-[9px] border border-brand-tintBorder bg-brand-tint px-3 py-2.5">
      <p class="text-[12px] font-semibold text-brand-text">{{ t('Switching now', 'Si cambias ahora') }}</p>
      <p class="mt-1.5 text-[12.5px] leading-[1.5] text-ink-700">
        {{ t(`You'd pay`, 'Pagarías') }} <strong class="font-mono font-semibold">{{ formatEur(prorationCents) }}</strong>
        {{ t('today.', 'hoy.') }}<template v-if="prorationNote">&nbsp;{{ prorationNote }}</template>
      </p>
    </div>

    <div class="mt-4">
      <button
        type="button"
        :disabled="current || busy"
        class="flex h-11 w-full items-center justify-center rounded-ctl text-[13.5px] font-semibold outline-none focus-visible:shadow-focus disabled:cursor-default lg:h-[34px]"
        :class="current ? 'border border-line-control bg-surface text-ink-700' : 'bg-brand text-white hover:bg-brand-hover'"
        @click="$emit('choose')"
      >
        {{ current ? t(`Stay on ${name}`, `Seguir en ${name}`) : busy ? t('Working…', 'Procesando…') : t(`Switch to ${name}`, `Cambiar a ${name}`) }}
      </button>
    </div>
  </div>
</template>
