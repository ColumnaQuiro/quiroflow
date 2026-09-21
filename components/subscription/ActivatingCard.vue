<script setup lang="ts">
import { formatEur } from '~/utils/billing'

// Back from Stripe checkout before the webhook has landed. The money is
// already gone from the customer's side, so the copy leads with that and says
// plainly that leaving the page costs nothing.
defineProps<{ amountCents: number | null; attempt: number; maxAttempts: number; secondsToNext: number; supportEmail: string }>()
defineEmits<{ refresh: [] }>()

const t = useT()
</script>

<template>
  <SubscriptionCard>
    <div class="flex items-start gap-3.5">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-success-border bg-success-bg">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[17px] w-[17px] text-success-text">
          <path d="M3.6 9.4L7.2 13L14.4 5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 class="text-[16px] font-semibold text-ink-900">
            {{ t('Payment received — activating your plan', 'Pago recibido: activando tu plan') }}
          </h2>
          <SubscriptionPill tone="success">{{ t('Activating', 'Activando') }}</SubscriptionPill>
        </div>
        <p class="mt-2 text-[13.5px] leading-[1.55] text-ink-500">
          <template v-if="amountCents !== null">
            {{ t('Stripe has taken', 'Stripe ha cobrado') }} <strong class="font-mono font-semibold">{{ formatEur(amountCents) }}</strong>.
          </template>
          {{
            t(
              `We're waiting for the confirmation to reach us, which usually takes a few seconds. You can leave this page — nothing is lost.`,
              'Estamos esperando la confirmación, que suele tardar unos segundos. Puedes salir de esta página: no se pierde nada.',
            )
          }}
        </p>
        <div class="mt-3.5 flex flex-wrap items-center gap-3">
          <div class="max-w-[320px] flex-1">
            <div class="h-1 overflow-hidden rounded-[3px] bg-line-divider">
              <div class="h-1 rounded-[3px] bg-success-accent" :style="{ width: `${Math.round((attempt / maxAttempts) * 100)}%` }" />
            </div>
          </div>
          <span class="text-[12px] text-ink-muted" aria-live="polite">
            {{ t(`Checking again in ${secondsToNext} s · attempt ${attempt} of ${maxAttempts}`, `Reintentando en ${secondsToNext} s · intento ${attempt} de ${maxAttempts}`) }}
          </span>
          <span class="flex-1" />
          <button
            type="button"
            class="h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-8"
            @click="$emit('refresh')"
          >
            {{ t('Refresh now', 'Actualizar ahora') }}
          </button>
        </div>
        <p class="mt-3 text-[12px] text-ink-muted">
          {{ t(`Still spinning after a minute? We'll email`, '¿Sigue así tras un minuto? Te escribiremos a') }} {{ supportEmail }}
          {{ t('and you can close the tab.', 'y puedes cerrar la pestaña.') }}
        </p>
      </div>
    </div>
  </SubscriptionCard>
</template>
