<script setup lang="ts">
import { growthIncluded, useGrowthCatalogue } from '~/composables/useGrowthPlans'
import { MONTHS_PER_YEAR, annualSavingPercent, formatEur } from '~/utils/billing'

const t = useT()
const store = useAccountStore()
const { growth } = useGrowthCatalogue()

const pricing = computed(() =>
  growth.value ? { monthlyPriceCents: growth.value.monthly_price_cents, annualPriceCents: growth.value.annual_price_cents } : null,
)

const options = computed(() => {
  const p = pricing.value
  return [
    {
      key: 'annual',
      label: p ? t(`Annual · save ${annualSavingPercent(p)}%`, `Anual · ahorra un ${annualSavingPercent(p)} %`) : t('Annual', 'Anual'),
      price: p ? formatEur(p.annualPriceCents) : '—',
      note: p ? t(`${formatEur(p.annualPriceCents * MONTHS_PER_YEAR)} billed yearly`, `${formatEur(p.annualPriceCents * MONTHS_PER_YEAR)} al año`) : '',
      featured: true,
    },
    {
      key: 'monthly',
      label: t('Monthly', 'Mensual'),
      price: p ? formatEur(p.monthlyPriceCents) : '—',
      note: t('Cancel any time', 'Cancela cuando quieras'),
      featured: false,
    },
  ]
})

// The case for it, worked from the monthly price rather than restating a
// conclusion reached at an older one: at 49 a 12-visit plan paid for "a year
// and a half" of Growth, and at 39 that sentence undersold it by six months.
// The 55 and 1,005 are the illustrative clinic this card has always used.
const INITIAL_VISIT_CENTS = 5500
const CARE_PLAN_CENTS = 100500
const included = computed(() => growthIncluded(t))
const initialVisit = formatEur(INITIAL_VISIT_CENTS)
const carePlan = formatEur(CARE_PLAN_CENTS)
const patientsToCover = computed(() => (pricing.value ? Math.max(1, Math.ceil(pricing.value.monthlyPriceCents / INITIAL_VISIT_CENTS)) : 1))
const monthsCovered = computed(() => (pricing.value ? Math.floor(CARE_PLAN_CENTS / pricing.value.monthlyPriceCents) : null))
</script>

<template>
  <div class="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-popover">
    <div class="flex flex-col gap-2">
      <span class="self-start rounded-pill bg-brand px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[.08em] text-brand-on">
        {{ t('Growth tier', 'Plan Growth') }}
      </span>
      <h2 class="text-[19px] font-semibold tracking-tightTitle text-ink-900">
        {{ t('The AI receptionist books patients while you are adjusting', 'La recepcionista IA reserva pacientes mientras tú ajustas') }}
      </h2>
      <p class="text-[12.5px] leading-[1.55] text-ink-muted">
        {{ t(
          'Growth’s AI receptionist answers enquiries on WhatsApp, Messenger and your website chat within a couple of minutes, and drafts Instagram replies for you to approve. It qualifies each one against your own rules and books it into the same calendar your front desk uses. Converting a lead opens a real patient record, so nothing is typed twice.',
          'La recepcionista IA de Growth responde las consultas de WhatsApp, Messenger y el chat de tu web en un par de minutos, y redacta las respuestas de Instagram para que las apruebes. Cualifica cada una según tus propias reglas y la reserva en el mismo calendario que usa tu recepción. Al convertir un lead se abre una ficha de paciente real: no se escribe nada dos veces.',
        ) }}
      </p>
    </div>

    <ul class="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      <li v-for="item in included" :key="item" class="flex items-start gap-2 text-[12px] text-ink-700">
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="mt-[3px] h-3 w-3 shrink-0 text-success-text">
          <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ item }}</span>
      </li>
    </ul>

    <div class="grid gap-2.5 sm:grid-cols-2">
      <div
        v-for="option in options"
        :key="option.key"
        class="flex flex-col gap-1.5 rounded-ctl border p-3"
        :class="option.featured ? 'border-brand-tintBorder bg-brand-tint' : 'border-line-control bg-surface'"
      >
        <span class="text-[11px] font-[640] uppercase tracking-[.07em]" :class="option.featured ? 'text-brand-text' : 'text-ink-muted'">
          {{ option.label }}
        </span>
        <div class="flex items-baseline gap-1.5">
          <span class="font-mono text-[23px] font-semibold leading-none text-ink-900">{{ option.price }}</span>
          <span class="text-[11px] text-ink-muted">{{ t('/ month', '/ mes') }}</span>
        </div>
        <span class="text-[11px] text-ink-faint">{{ option.note }}</span>
      </div>
    </div>

    <p class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-muted">
      <!-- The arithmetic here is derived from the price, so it changes when
      the price does. At EUR 299 this said six extra conversions were needed
      to cover it; at EUR 39 one does, and claiming otherwise would be
      understating the product as badly as overstating it. -->
      <!-- It opened with "Clinics of your size book 18-24 extra new patients
      a month with Growth", a figure nothing in the product measures or
      records. Only the arithmetic, which is the price's, stays. -->
      {{ patientsToCover === 1
        ? t(`At an initial visit of ${initialVisit}, one extra new patient a month covers it`, `Con una primera visita de ${initialVisit}, un paciente nuevo más al mes lo cubre`)
        : t(`At an initial visit of ${initialVisit}, ${patientsToCover} extra new patients a month cover it`, `Con una primera visita de ${initialVisit}, ${patientsToCover} pacientes nuevos más al mes lo cubren`) }}<template v-if="monthsCovered">{{ t(
        `, and a 12-visit plan of ${carePlan} covers ${monthsCovered} months of it.`,
        `, y un plan de 12 visitas de ${carePlan} cubre ${monthsCovered} meses.`,
      ) }}</template><template v-else>.</template>
    </p>

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-2">
        <!-- Adding Growth happens on /subscription, whose plan picker adds it
        to the existing Stripe subscription with a prorated charge. This said
        "Start 14-day trial" and "No card required", and there is no such
        trial: whoever sees this card is past theirs (a trial already has
        Growth), and the picker bills the card on file. -->
        <NuxtLink
          v-if="store.isOwner"
          to="/subscription"
          class="flex h-9 touch:h-11 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover"
        >{{ t('Add Growth', 'Añadir Growth') }}</NuxtLink>
        <a
          href="mailto:hola@quiroflow.com?subject=QuiroFlow%20Growth"
          class="flex h-9 touch:h-11 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Talk to us', 'Hablemos') }}</a>
      </div>
      <p class="text-[11px] text-ink-faint">
        <template v-if="store.isOwner">
          {{ t(
            'Added to your current plan · your existing recalls and campaigns keep running',
            'Se añade a tu plan actual · tus recordatorios y campañas actuales siguen funcionando',
          ) }}
        </template>
        <template v-else>
          {{ t(
            'Ask the account owner to add Growth · your existing recalls and campaigns keep running',
            'Pide al propietario de la cuenta que añada Growth · tus recordatorios y campañas actuales siguen funcionando',
          ) }}
        </template>
      </p>
    </div>
  </div>
</template>
