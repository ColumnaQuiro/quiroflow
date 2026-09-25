<script setup lang="ts">
// One record rather than the two nearly-empty cards this replaced: the old
// Billing tab spent a whole screen on a country code and a card brand.
//
// Every value is read-only. Editing any of it opens Stripe.
const props = defineProps<{
  accountName: string
  ownerName: string | null
  billingEmail: string | null
  country: string | null
  taxId: string | null
  address: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null } | null
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null
}>()

defineEmits<{ portal: [] }>()

const t = useT()

const addressLine = computed(() => {
  const a = props.address
  if (!a) return null
  return [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
})
</script>

<template>
  <SubscriptionCard>
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
      <div class="flex-1">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Billing details', 'Datos de facturación') }}</h3>
        <p class="mt-1 text-[12.5px] text-ink-muted">
          {{ t(`What appears on every invoice we issue for ${accountName}.`, `Lo que aparece en cada factura que emitimos para ${accountName}.`) }}
        </p>
      </div>
      <button
        type="button"
        class="flex h-9 touch:h-11 items-center justify-center gap-1.5 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
        @click="$emit('portal')"
      >
        {{ t('Manage in Stripe', 'Gestionar en Stripe') }}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
          <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <dl class="mt-3.5 border-t border-line-divider">
      <div class="flex flex-col gap-1 border-b border-line-divider py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Billed to', 'Facturado a') }}</dt>
        <dd class="flex-1 text-[13.5px] font-medium text-ink-900">
          {{ accountName }}
          <span v-if="ownerName" class="mt-[3px] block text-[12px] font-normal text-ink-muted">{{ ownerName }}, {{ t('account owner', 'propietario de la cuenta') }}</span>
        </dd>
      </div>
      <div class="flex flex-col gap-1 border-b border-line-divider py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Billing email', 'Email de facturación') }}</dt>
        <dd class="flex-1 text-[13.5px] font-medium text-ink-900">
          {{ billingEmail ?? t('Not set', 'Sin definir') }}
          <span class="mt-[3px] block text-[12px] font-normal text-ink-muted">{{ t('Invoices and payment receipts are sent here', 'Aquí se envían las facturas y los recibos') }}</span>
        </dd>
      </div>
      <div class="flex flex-col gap-1 border-b border-line-divider py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Country', 'País') }}</dt>
        <dd class="flex-1 text-[13.5px] font-medium text-ink-900">
          {{ country ?? t('Not set', 'Sin definir') }}
          <span class="mt-[3px] block text-[12px] font-normal text-ink-muted">{{ t('Sets the tax rate', 'Determina el tipo impositivo') }}</span>
        </dd>
      </div>
      <div class="flex flex-col gap-1 border-b border-line-divider py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Tax ID (NIF)', 'NIF') }}</dt>
        <dd class="flex-1 font-mono text-[13.5px] font-medium text-ink-900">{{ taxId ?? '—' }}</dd>
      </div>
      <div class="flex flex-col gap-1 border-b border-line-divider py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Billing address', 'Dirección de facturación') }}</dt>
        <dd class="flex-1 text-[13.5px] font-medium text-ink-900">{{ addressLine ?? '—' }}</dd>
      </div>
      <div class="flex flex-col gap-1 py-3.5 lg:flex-row lg:items-start lg:gap-4">
        <dt class="w-[168px] shrink-0 text-[12.5px] text-ink-muted">{{ t('Payment method', 'Método de pago') }}</dt>
        <dd class="flex-1 font-mono text-[13.5px] font-medium capitalize text-ink-900">
          <template v-if="card">
            {{ card.brand }} ·· {{ card.last4 }}
            <span class="mt-[3px] block font-sans text-[12px] font-normal normal-case text-ink-muted">
              {{ t('Expires', 'Caduca') }} {{ String(card.expMonth).padStart(2, '0') }}/{{ card.expYear }}
            </span>
          </template>
          <template v-else>—</template>
        </dd>
        <div class="shrink-0">
          <SubscriptionOutboundLink as="button" @click="$emit('portal')">{{ t('Update card', 'Actualizar tarjeta') }}</SubscriptionOutboundLink>
        </div>
      </div>
    </dl>
  </SubscriptionCard>
</template>
