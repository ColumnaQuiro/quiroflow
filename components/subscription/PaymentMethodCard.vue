<script setup lang="ts">
defineProps<{ card: { brand: string; last4: string; expMonth: number; expYear: number } | null; holder: string | null }>()
defineEmits<{ portal: [] }>()
const t = useT()
</script>

<template>
  <SubscriptionCard>
    <div class="flex items-center gap-2.5">
      <span class="flex h-6 w-[34px] shrink-0 items-center justify-center rounded-[5px] border border-line-control bg-surface-subtle">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-3.5 w-3.5 text-ink-muted">
          <rect x="2.4" y="4.4" width="13.2" height="9.2" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M2.4 7.6h13.2" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <div class="font-mono text-[13.5px] font-medium capitalize text-ink-900">
          <template v-if="card">{{ card.brand }} ·· {{ card.last4 }}</template>
          <template v-else>{{ t('No card on file', 'Sin tarjeta guardada') }}</template>
        </div>
        <div v-if="card" class="mt-0.5 text-[11.5px] text-ink-muted">
          {{ t('Expires', 'Caduca') }} {{ String(card.expMonth).padStart(2, '0') }}/{{ card.expYear }}<template v-if="holder"> · {{ holder }}</template>
        </div>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-between border-t border-line-divider pt-3">
      <SubscriptionOutboundLink as="button" @click="$emit('portal')">
        {{ card ? t('Manage payment method', 'Gestionar método de pago') : t('Add payment method', 'Añadir método de pago') }}
      </SubscriptionOutboundLink>
      <span class="text-[11.5px] text-ink-muted">{{ t('Held by Stripe', 'Custodiada por Stripe') }}</span>
    </div>
  </SubscriptionCard>
</template>
