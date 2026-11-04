<script setup lang="ts">
// What Growth > AI receptionist shows a clinic whose subscription does not
// include it -- most often one on the free trial, which gives Growth but not
// the receptionist.
//
// It was one grey sentence and two buttons, and before that, for a trial
// reaching the page with the store's word and the server's disagreeing, a red
// "Could not load the receptionist settings" that read as a fault. This shows
// the thing itself: an enquiry answered and booked, drawn from the app's own
// tokens like the onboarding previews, so the upgrade is for something seen.
//
// The patient and practitioner are the vetted demo names from
// components/onboarding/previewFixtures.ts.
defineProps<{ trialing: boolean }>()

const t = useT()
</script>

<template>
  <div class="mx-auto grid max-w-[920px] items-center gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-12 lg:py-12" data-test="receptionist-locked">
    <div class="order-2 lg:order-1">
      <span class="inline-flex rounded-pill border border-brand-tintBorder bg-brand-tint px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[.08em] text-brand-text">
        {{ trialing ? t('Not in the free trial', 'No incluida en la prueba') : t('Add-on', 'Complemento') }}
      </span>
      <h2 class="mt-3 text-[22px] font-semibold leading-[1.25] tracking-tightTitle text-ink-900">
        {{ t('An AI receptionist that answers and books while you treat', 'Una recepcionista IA que responde y reserva mientras tú tratas') }}
      </h2>
      <p class="mt-2.5 text-[13.5px] leading-[1.6] text-ink-muted">
        {{
          trialing
            ? t(
                'It is not part of the free trial. Upgrade to add it on its own, or with Growth, and it starts answering WhatsApp, Instagram and web chat in your clinic’s name, booking straight into your calendar.',
                'No está incluida en la prueba gratuita. Mejora tu plan para añadirla por sí sola, o con Growth, y empezará a responder WhatsApp, Instagram y el chat web en nombre de tu clínica, reservando directamente en tu agenda.',
              )
            : t(
                'Add it on its own, or get it with Growth, and it starts answering WhatsApp, Instagram and web chat in your clinic’s name, booking straight into your calendar.',
                'Añádela por sí sola, o consíguela con Growth, y empezará a responder WhatsApp, Instagram y el chat web en nombre de tu clínica, reservando directamente en tu agenda.',
              )
        }}
      </p>
      <ul class="mt-4 flex flex-col gap-1.5">
        <li v-for="item in [
          t('Replies in under a minute, day and night', 'Responde en menos de un minuto, de día y de noche'),
          t('Only offers the types and times you allow', 'Solo ofrece los tipos y horarios que permites'),
          t('Hands the conversation to you when it should', 'Te pasa la conversación cuando debe'),
        ]" :key="item" class="flex items-start gap-2 text-[13px] text-ink-700">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="mt-[3px] h-3 w-3 shrink-0 text-success-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{{ item }}</span>
        </li>
      </ul>
      <div class="mt-5 flex flex-wrap gap-2">
        <NuxtLink to="/subscription" class="inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11" data-test="receptionist-upgrade">
          {{ trialing ? t('Upgrade to add it', 'Mejorar para añadirla') : t('Add the receptionist', 'Añadir la recepcionista') }}
        </NuxtLink>
        <NuxtLink to="/growth" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:border-line-controlHover touch:h-11">
          {{ t('See what Growth adds', 'Ver qué añade Growth') }}
        </NuxtLink>
      </div>
    </div>

    <!-- The illustration: a conversation it handled, end to end. Decorative,
         so it is hidden from assistive tech; the copy beside it says it all. -->
    <div class="order-1 lg:order-2" aria-hidden="true">
      <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div class="flex items-center gap-2.5 border-b border-line-divider px-4 py-3">
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-control bg-surface-subtle">
            <span class="text-[11px] font-semibold text-ink-500">LF</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-semibold text-ink-900">Lucía Ferrer</div>
            <div class="text-[11.5px] text-ink-muted">WhatsApp · 22:47</div>
          </div>
          <span class="flex shrink-0 items-center gap-1 rounded-pill border border-brand-tintBorder bg-brand-tint px-2 py-[3px] text-[11px] font-semibold text-brand-text">
            <svg viewBox="0 0 16 16" fill="none" class="h-3 w-3">
              <path d="M8 2.2l1.4 3.1 3.4.4-2.5 2.3.7 3.4L8 9.7l-3 1.7.7-3.4-2.5-2.3 3.4-.4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
            </svg>
            {{ t('AI', 'IA') }}
          </span>
        </div>
        <div class="flex flex-col gap-2.5 bg-surface-page/60 p-4">
          <div class="max-w-[85%] self-start rounded-[11px] rounded-bl-[3px] border border-line-control bg-surface px-3 py-2 text-[12.5px] leading-[1.5] text-ink-700">
            {{ t('Hi! Do you have anything Thursday afternoon? My lower back is killing me', '¡Hola! ¿Tenéis algo el jueves por la tarde? Tengo la lumbar fatal') }}
          </div>
          <div class="max-w-[85%] self-end rounded-[11px] rounded-br-[3px] bg-brand px-3 py-2 text-[12.5px] leading-[1.5] text-brand-on">
            {{ t('Sorry to hear that, Lucía. Thursday at 17:30 with Alba Esteve is free. Shall I book it?', 'Siento oírlo, Lucía. El jueves a las 17:30 con Alba Esteve hay hueco. ¿Te lo reservo?') }}
          </div>
          <div class="max-w-[85%] self-start rounded-[11px] rounded-bl-[3px] border border-line-control bg-surface px-3 py-2 text-[12.5px] leading-[1.5] text-ink-700">
            {{ t('Yes please!', '¡Sí, porfa!') }}
          </div>
          <div class="flex items-center gap-2 rounded-[9px] border border-success-border bg-success-bg px-[11px] py-2">
            <svg viewBox="0 0 12 12" fill="none" class="h-3.5 w-3.5 shrink-0 text-success-text">
              <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="truncate text-[12px] font-semibold text-success-text">{{ t('Booked · Thu 17:30 · Alba Esteve', 'Reservada · Jue 17:30 · Alba Esteve') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
