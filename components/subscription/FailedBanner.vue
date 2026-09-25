<script setup lang="ts">
import { formatEur, formatLongDate } from '~/utils/billing'

// One banner, one rail card, one pill. The page does not turn red: a clinic
// whose card bounced needs to find the fix, not be shouted at.
defineProps<{
  amountCents: number | null
  attemptedOn: string | null
  card: { brand: string; last4: string } | null
  declineReason: string | null
  nextAttemptAt: string | null
  cancelAt: string | null
  invoiceUrl: string | null
}>()
defineEmits<{ updateCard: [] }>()

const t = useT()
</script>

<template>
  <div class="rounded-card border border-danger-border bg-danger-bg p-[18px]">
    <h2 class="text-[16px] font-semibold text-ink-900">{{ t('Your last payment failed', 'Tu último pago fue rechazado') }}</h2>
    <p class="mt-2 text-[13px] leading-[1.55] text-ink-700">
      <template v-if="amountCents !== null && attemptedOn">
        {{ t('We tried to charge', 'Intentamos cobrar') }} <strong class="font-mono font-semibold">{{ formatEur(amountCents) }}</strong>
        {{ t('on', 'el') }} {{ formatLongDate(attemptedOn) }}<template v-if="card">&nbsp;{{ t('to', 'a la') }} <span class="capitalize">{{ card.brand }}</span> ·· {{ card.last4 }}</template>.
      </template>
      <template v-if="declineReason">{{ declineReason }}</template>
    </p>

    <!-- Nested and neutral: the consequences matter, but they are not another
         alarm. The reassurance is the most important sentence on the page. -->
    <div class="mt-3.5 rounded-ctl border border-line bg-surface px-3.5 py-3">
      <p class="text-[12.5px] font-semibold text-ink-900">{{ t(`What happens if it isn't paid`, 'Qué pasa si no se paga') }}</p>
      <p class="mt-1.5 text-[12.5px] leading-[1.55] text-ink-muted">
        <template v-if="nextAttemptAt">
          {{ t('We try again on', 'Lo volvemos a intentar el') }} {{ formatLongDate(nextAttemptAt) }}.
        </template>
        <template v-else>
          {{ t('We will try the card again automatically.', 'Volveremos a intentar el cobro automáticamente.') }}
        </template>
        <!-- Only when Stripe is actually configured to cancel. Inventing a
             cut-off date is worse than not naming one: a clinic would plan
             around it. -->
        <template v-if="cancelAt">
          {{ t('If it keeps failing, access ends on', 'Si sigue fallando, el acceso termina el') }} {{ formatLongDate(cancelAt) }}.
        </template>
        <template v-else>
          {{ t('Access continues while we keep retrying.', 'El acceso continúa mientras seguimos reintentando.') }}
        </template>
      </p>
      <p class="mt-2 text-[12.5px] leading-[1.55] text-ink-700">
        {{
          t(
            'Your calendar and your patient records stay safe and readable throughout. Online booking and automatic reminders pause until the payment goes through.',
            'Tu agenda y los historiales de tus pacientes siguen seguros y accesibles en todo momento. Las reservas online y los recordatorios automáticos se pausan hasta que el pago se complete.',
          )
        }}
      </p>
    </div>

    <div class="mt-3.5 flex flex-col gap-2.5 lg:flex-row lg:items-center">
      <button
        type="button"
        class="flex h-9 touch:h-11 items-center justify-center gap-1.5 rounded-ctl bg-danger-text px-3.5 text-[13.5px] font-semibold text-white outline-none focus-visible:shadow-focusDanger lg:h-[34px]"
        @click="$emit('updateCard')"
      >
        {{ t('Update card in Stripe', 'Actualizar tarjeta en Stripe') }}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
          <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
      <a
        v-if="invoiceUrl"
        :href="invoiceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="flex h-9 touch:h-11 items-center justify-center rounded-ctl px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:bg-surface focus-visible:shadow-focus lg:h-[34px]"
      >
        {{ t('View the failed invoice', 'Ver la factura rechazada') }}
      </a>
    </div>
  </div>
</template>
