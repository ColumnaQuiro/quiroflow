<script setup lang="ts">
const t = useT()

// A brand-new clinic has no leads yet, so the empty state says where they
// come from and links to each place that sets one up.
//
// It used to be a checklist with a fixed "1 of 4 done": "Public booking page
// live" ticked for every account and the other three never ticked. Online
// booking is off until a clinic turns it on (clinics.online_booking_enabled
// defaults to false), and a clinic with WhatsApp already connected was told
// to connect it. Nothing here read the account, so nothing here was true for
// anyone in particular. The ways in are listed instead, without a state.
const steps = [
  { label: t('Connect WhatsApp, Instagram, Messenger or your website chat', 'Conecta WhatsApp, Instagram, Messenger o el chat de tu web'), to: '/settings/whatsapp' },
  { label: t('Connect your Meta lead ad forms', 'Conecta los formularios de tus anuncios de Meta'), to: '/settings/leads' },
  { label: t('Turn on the AI receptionist', 'Activa la recepcionista IA'), to: '/growth/receptionist' },
]
</script>

<template>
  <div class="flex justify-center px-4 py-12">
    <div class="flex w-full max-w-[520px] flex-col items-center gap-5 text-center">
      <div class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint text-[20px] font-light text-brand-text">
        +
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('No leads yet', 'Aún no hay leads') }}</h2>
        <p class="text-[12.5px] leading-[1.55] text-ink-muted">
          {{ t(
            'Connect a channel and the first enquiry lands here. Visits the AI receptionist books go straight into your clinic calendar, and converting a lead opens a real patient record.',
            'Conecta un canal y la primera consulta aparecerá aquí. Las citas que reserve la recepcionista IA entran directamente en el calendario de tu clínica, y al convertir un lead se abre una ficha de paciente real.',
          ) }}
        </p>
      </div>

      <div class="flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/settings/whatsapp"
          class="flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover"
        >{{ t('Connect WhatsApp', 'Conectar WhatsApp') }}</NuxtLink>
        <button
          type="button"
          class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Add lead manually', 'Añadir lead a mano') }}</button>
      </div>

      <div class="flex w-full flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-left shadow-card">
        <span class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint">
          {{ t('Where leads come from', 'De dónde llegan los leads') }}
        </span>
        <ul class="flex flex-col gap-1.5">
          <li v-for="step in steps" :key="step.to" class="flex items-center gap-2 text-[12px]">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint3" aria-hidden="true" />
            <NuxtLink :to="step.to" class="text-ink-700 hover:text-brand-text hover:underline">{{ step.label }} →</NuxtLink>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
