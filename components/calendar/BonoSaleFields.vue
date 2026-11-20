<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import type { VisitBonoTemplate } from '~/composables/useVisitCharging'

// The bono sale's fields in the visit checkout: which bono, how it is paid,
// what is paid now and by what method. Two places sell from the checkout --
// "Vender un bono" with this visit as its first session, and "Vender bono
// nuevo" once the visit has finished the last one -- so the fields live here
// once. The state stays with VisitCheckout, which is what sells.

defineProps<{
  templates: VisitBonoTemplate[]
  template: VisitBonoTemplate | null
  options: { installments: number; installmentCents: number }[]
  amountCents: number
  totalCents: number
  paymentMethods: { key: string; name: string }[]
  spendableCreditCents: number
  disabled: boolean
}>()
const id = defineModel<string>('id', { required: true })
const installments = defineModel<number>('installments', { required: true })
const amount = defineModel<string>('amount', { required: true })
const method = defineModel<string>('method', { required: true })

const t = useT()
</script>

<template>
  <div class="flex flex-col gap-2 text-[12.5px] font-medium text-ink-600">
    <label class="flex items-center gap-2">
      {{ t('Bono', 'Bono') }}
      <select v-model="id" data-cy="checkout-sell-select" :disabled="disabled" class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
        <option value="" disabled>{{ templates.length ? t('Choose a bono…', 'Elige un bono…') : t('No bonos set up', 'No hay bonos configurados') }}</option>
        <option v-for="b in templates" :key="b.id" :value="b.id">{{ b.name }} ({{ b.session_count }}, {{ formatEur(b.price_cents) }})</option>
      </select>
    </label>
    <label v-if="template && options.length" class="flex items-center gap-2">
      {{ t('How it is paid', 'Forma de pago') }}
      <select v-model.number="installments" data-cy="checkout-sell-installments" :disabled="disabled" class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
        <option :value="1">{{ t(`At once · ${formatEur(template.price_cents)}`, `En un pago · ${formatEur(template.price_cents)}`) }}</option>
        <option v-for="o in options" :key="o.installments" :value="o.installments">
          {{ t(`${o.installments} plazos of ${formatEur(o.installmentCents)}`, `${o.installments} plazos de ${formatEur(o.installmentCents)}`) }}
        </option>
      </select>
    </label>
    <div v-if="template" class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-2">
        {{ t('Paid now (€)', 'Pagado ahora (€)') }}
        <input v-model="amount" data-cy="checkout-sell-amount" type="number" min="0" step="0.01" inputmode="decimal" :disabled="disabled" class="h-9 touch:h-11 w-24 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
      </label>
      <label v-if="amountCents > 0" class="flex min-w-0 flex-1 items-center gap-2">
        {{ t('Method', 'Método') }}
        <select v-model="method" data-cy="checkout-sell-method" :disabled="disabled" class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
          <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
          <option v-if="spendableCreditCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} ({{ formatEur(spendableCreditCents) }} {{ t('available', 'disponible') }})</option>
        </select>
      </label>
    </div>
    <p v-if="template && amountCents < totalCents" class="text-[11.5px] font-normal text-ink-faint" data-cy="checkout-sell-owed-note">
      {{ t('The rest stays owed on the bono; collect it later from the patient record.', 'El resto queda pendiente en el bono; cóbralo después desde la ficha del paciente.') }}
    </p>
  </div>
</template>
