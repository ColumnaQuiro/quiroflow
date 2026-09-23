<script setup lang="ts">
import { GROWTH_INCLUDED, useGrowthCatalogue } from '~/composables/useGrowthPlans'
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
const patientsToCover = computed(() => (pricing.value ? Math.max(1, Math.ceil(pricing.value.monthlyPriceCents / INITIAL_VISIT_CENTS)) : 1))
const monthsCovered = computed(() => (pricing.value ? Math.floor(CARE_PLAN_CENTS / pricing.value.monthlyPriceCents) : null))
</script>

<template>
  <div class="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-popover">
    <div class="flex flex-col gap-2">
      <span class="self-start rounded-pill bg-brand px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[.08em] text-white">
        {{ t('Growth tier', 'Plan Growth') }}
      </span>
      <h2 class="text-[19px] font-semibold tracking-tightTitle text-ink-900">
        {{ t('The AI receptionist books patients while you are adjusting', 'La recepcionista IA reserva pacientes mientras tú ajustas') }}
      </h2>
      <p class="text-[12.5px] leading-[1.55] text-ink-muted">
        {{ t(
          'Growth answers every enquiry in under a minute on WhatsApp, SMS and web chat, qualifies it against your own rules, and books it into the same calendar your front desk uses. Converting a lead opens a real patient record — nothing is re-typed.',
          'Growth responde a cada consulta en menos de un minuto por WhatsApp, SMS y chat web, la cualifica según tus propias reglas y la reserva en el mismo calendario que usa tu recepción. Al convertir un contacto se abre una ficha de paciente real: no se reescribe nada.',
        ) }}
      </p>
    </div>

    <ul class="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      <li v-for="item in GROWTH_INCLUDED" :key="item" class="flex items-start gap-2 text-[12px] text-ink-700">
        <span class="mt-px text-[11px] font-semibold text-success-text">✓</span>
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
        <span class="text-[10.5px] font-semibold uppercase tracking-[.06em]" :class="option.featured ? 'text-brand-text' : 'text-ink-muted'">
          {{ option.label }}
        </span>
        <div class="flex items-baseline gap-1.5">
          <span class="text-[24px] font-semibold leading-none tracking-tightTitle text-ink-900">{{ option.price }}</span>
          <span class="text-[11px] text-ink-muted">{{ t('/ month', '/ mes') }}</span>
        </div>
        <span class="text-[10.5px] text-ink-faint">{{ option.note }}</span>
      </div>
    </div>

    <p class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-muted">
      <!-- The arithmetic here is derived from the price, so it changes when
      the price does. At EUR 299 this said six extra conversions were needed
      to cover it; at EUR 39 one does, and claiming otherwise would be
      understating the product as badly as overstating it. -->
      {{ t('Clinics of your size book', 'Las clínicas de tu tamaño consiguen') }}
      <strong class="font-semibold text-ink-700">{{ t('18–24 extra new patients a month', '18–24 pacientes nuevos más al mes') }}</strong>
      {{ patientsToCover === 1
        ? t('with Growth. At an average initial visit of €55, a single extra new patient covers it', 'con Growth. Con una primera visita media de 55 €, un solo paciente nuevo lo cubre')
        : t(`with Growth. At an average initial visit of €55, ${patientsToCover} extra new patients cover it`, `con Growth. Con una primera visita media de 55 €, ${patientsToCover} pacientes nuevos lo cubren`) }}<template v-if="monthsCovered">{{ t(
        ` — and a 12-visit plan of €1,005 covers ${monthsCovered} months of it.`,
        `, y un plan de 12 visitas de 1.005 € cubre ${monthsCovered} meses.`,
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
          class="flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
        >{{ t('Add Growth', 'Añadir Growth') }}</NuxtLink>
        <a
          href="mailto:hola@quiroflow.com?subject=QuiroFlow%20Growth"
          class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Talk to us', 'Hablemos') }}</a>
      </div>
      <p class="text-[10.5px] text-ink-faint">
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
