<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

// Everything that edits billing, in one place, all of it outbound.
//
// There is deliberately no in-app equivalent of any of these: QuiroFlow never
// holds a card, so a form that looked like it did would be a lie with a
// compliance cost attached.
defineProps<{ customerSince: string | null; accessEndsAt: string | null }>()
defineEmits<{ portal: [], cancel: [] }>()

const t = useT()
</script>

<template>
  <SubscriptionCard>
    <div class="flex items-start gap-3">
      <span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-ctl border border-brand-tintBorder bg-brand-tint">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-brand-text">
          <rect x="3.6" y="7.4" width="10.8" height="7.2" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M6.2 7.4V5.4a2.8 2.8 0 0 1 5.6 0v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <div>
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Card and billing data live in Stripe', 'La tarjeta y los datos de facturación están en Stripe') }}</h3>
        <p class="mt-1.5 text-[12.5px] leading-[1.55] text-ink-muted">
          {{
            t(
              `QuiroFlow never stores or edits your card. Each action below opens Stripe's secure customer portal in a new tab; changes appear here within a few seconds of coming back.`,
              'QuiroFlow nunca guarda ni edita tu tarjeta. Cada acción abre el portal seguro de Stripe en una pestaña nueva; los cambios aparecen aquí a los pocos segundos de volver.',
            )
          }}
        </p>
      </div>
    </div>

    <div class="mt-3.5 border-t border-line-divider">
      <SubscriptionStripeHandoffRow
        :label="t('Update payment method', 'Actualizar el método de pago')"
        :description="t('Replace the card or add a backup', 'Cambia la tarjeta o añade una de respaldo')"
        @click="$emit('portal')"
      >
        <template #icon>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-ink-muted">
            <rect x="2.4" y="4.4" width="13.2" height="9.2" rx="2" stroke="currentColor" stroke-width="1.4" />
            <path d="M2.4 7.6h13.2" stroke="currentColor" stroke-width="1.4" />
          </svg>
        </template>
      </SubscriptionStripeHandoffRow>

      <SubscriptionStripeHandoffRow
        :label="t('Edit billing details and tax ID', 'Editar datos de facturación y NIF')"
        :description="t('Company name, NIF, address and billing email', 'Razón social, NIF, dirección y email de facturación')"
        @click="$emit('portal')"
      >
        <template #icon>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-ink-muted">
            <path d="M4.4 2.8h9.2v12.4H4.4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <path d="M7 6.6h4M7 9.4h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </template>
      </SubscriptionStripeHandoffRow>

      <SubscriptionStripeHandoffRow
        :label="t('Download past invoices', 'Descargar facturas anteriores')"
        :description="customerSince ? t(`Every invoice since ${formatLongDate(customerSince)}`, `Todas las facturas desde el ${formatLongDate(customerSince)}`) : t('Every invoice we have issued', 'Todas las facturas emitidas')"
        @click="$emit('portal')"
      >
        <template #icon>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-ink-muted">
            <path d="M9 3v8M5.8 8.2L9 11.4l3.2-3.2M3.8 14.4h10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </template>
      </SubscriptionStripeHandoffRow>

      <SubscriptionStripeHandoffRow
        tone="danger"
        last
        :label="t('Cancel subscription', 'Cancelar la suscripción')"
        :description="accessEndsAt ? t(`Stays active until ${formatLongDate(accessEndsAt)}, then stops`, `Sigue activa hasta el ${formatLongDate(accessEndsAt)}, y entonces termina`) : t('Stays active until the end of the period you have paid for', 'Sigue activa hasta el final del periodo pagado')"
        @click="$emit('cancel')"
      >
        <template #icon>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-danger-text">
            <circle cx="9" cy="9" r="6.2" stroke="currentColor" stroke-width="1.4" />
            <path d="M6.4 6.4l5.2 5.2M11.6 6.4l-5.2 5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </template>
      </SubscriptionStripeHandoffRow>
    </div>
  </SubscriptionCard>
</template>
