<script setup lang="ts">
import { GROWTH_INCLUDED, GROWTH_PRICING } from '~/composables/useGrowthPlans'

const t = useT()
const store = useAccountStore()
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
        v-for="option in GROWTH_PRICING"
        :key="option.key"
        class="flex flex-col gap-1.5 rounded-ctl border p-3"
        :class="option.featured ? 'border-brand-tintBorder bg-brand-tint' : 'border-line-control bg-surface'"
      >
        <span class="text-[10.5px] font-semibold uppercase tracking-[.06em]" :class="option.featured ? 'text-brand-text' : 'text-ink-muted'">
          {{ option.label }}
        </span>
        <div class="flex items-baseline gap-1.5">
          <span class="text-[24px] font-semibold leading-none tracking-tightTitle text-ink-900">{{ option.price }}</span>
          <span class="text-[11px] text-ink-muted">{{ option.unit }}</span>
        </div>
        <span class="text-[10.5px] text-ink-faint">{{ option.note }}</span>
      </div>
    </div>

    <p class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-muted">
      {{ t('Clinics of your size book', 'Las clínicas de tu tamaño consiguen') }}
      <strong class="font-semibold text-ink-700">{{ t('18–24 extra new patients a month', '18–24 pacientes nuevos más al mes') }}</strong>
      {{ t(
        'with Growth. At your average initial value of €55 and a 12-visit plan of €1,005, six extra conversions cover the tier — about',
        'con Growth. Con tu valor medio inicial de 55 € y un plan de 12 visitas de 1.005 €, seis conversiones extra cubren el plan: unos',
      ) }}
      <strong class="font-semibold text-ink-700">{{ t('€12 per new patient acquired', '12 € por paciente nuevo captado') }}</strong>.
    </p>

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-2">
        <!-- Both routes go somewhere real. There is no Stripe price for
        Growth yet, so the trial cannot open Checkout directly -- /subscription
        is the page that already handles starting and repairing a
        subscription, and it stays reachable while an account is locked. -->
        <NuxtLink
          v-if="store.isOwner"
          to="/subscription"
          class="flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
        >{{ t('Start 14-day trial', 'Empezar prueba de 14 días') }}</NuxtLink>
        <a
          href="mailto:hola@columnaquiro.com?subject=QuiroFlow%20Growth"
          class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Talk to us', 'Hablemos') }}</a>
      </div>
      <p class="text-[10.5px] text-ink-faint">
        <template v-if="store.isOwner">
          {{ t(
            'No card required · your existing recalls and campaigns keep running',
            'Sin tarjeta · tus recordatorios y campañas actuales siguen funcionando',
          ) }}
        </template>
        <template v-else>
          {{ t(
            'Ask the account owner to start the trial · your existing recalls and campaigns keep running',
            'Pide al propietario de la cuenta que inicie la prueba · tus recordatorios y campañas actuales siguen funcionando',
          ) }}
        </template>
      </p>
    </div>
  </div>
</template>
