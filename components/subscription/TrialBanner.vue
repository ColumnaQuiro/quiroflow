<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

// An invitation, not a warning. Info purple throughout: a trial with time
// left on it is good news, and dressing it in amber makes a clinic think
// something has gone wrong.
//
// `cardOnFile`: the owner has already been through Checkout, which carried the
// trial over (checkoutTrialEnd), so the same countdown now ends in a first
// payment rather than a lock. It says that instead of asking for the card
// again.
const props = defineProps<{ daysLeft: number; totalDays: number; endsAt: string | null; cardOnFile?: boolean }>()
defineEmits<{ addCard: [], comparePlans: [] }>()

const t = useT()
const elapsed = computed(() => Math.max(0, Math.min(props.totalDays, props.totalDays - props.daysLeft)))
const percent = computed(() => Math.round((elapsed.value / props.totalDays) * 100))
</script>

<template>
  <div class="rounded-card border border-info-border bg-info-bg p-[18px]" data-test="trial-banner">
    <div class="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:gap-4">
      <div class="flex-1">
        <h2 class="text-[16px] font-semibold text-ink-900">
          {{ daysLeft === 0 ? t('Your free trial ends today', 'Tu prueba gratuita termina hoy') : t(`${daysLeft} days left in your free trial`, `Te quedan ${daysLeft} días de prueba gratuita`) }}
        </h2>
        <p v-if="cardOnFile" class="mt-2 text-[13px] leading-[1.55] text-ink-700">
          {{ t('Your card is on file and nothing has been charged yet.', 'Tu tarjeta está guardada y todavía no se ha cobrado nada.') }}
          <template v-if="endsAt">
            {{ t('The first payment is taken on', 'El primer pago será el') }}
            <strong class="font-semibold text-ink-900">{{ formatLongDate(endsAt) }}</strong>,
            {{ t('when the trial ends.', 'cuando termine la prueba.') }}
          </template>
        </p>
        <p v-else class="mt-2 text-[13px] leading-[1.55] text-ink-700">
          <template v-if="endsAt">
            {{ t('Everything keeps working until', 'Todo sigue funcionando hasta el') }}
            <strong class="font-semibold text-ink-900">{{ formatLongDate(endsAt) }}</strong>.
          </template>
          {{ t('Add a card before then and nothing is interrupted.', 'Añade una tarjeta antes de esa fecha y no se interrumpe nada.') }}
        </p>
        <div class="mt-3 flex items-center gap-3">
          <div class="h-1 max-w-[260px] flex-1 overflow-hidden rounded-[3px] bg-info-border">
            <div class="h-1 rounded-[3px] bg-info-accent" :style="{ width: `${percent}%` }" />
          </div>
          <span class="text-[12px] text-ink-muted">{{ t(`Day ${elapsed} of ${totalDays}`, `Día ${elapsed} de ${totalDays}`) }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <button
          v-if="!cardOnFile"
          type="button"
          class="flex h-11 items-center justify-center gap-1.5 rounded-ctl bg-brand px-3.5 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus lg:h-[34px]"
          @click="$emit('addCard')"
        >
          {{ t('Add payment method', 'Añadir método de pago') }}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
            <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-11 items-center justify-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
          @click="$emit('comparePlans')"
        >
          {{ t('Compare plans', 'Comparar planes') }}
        </button>
      </div>
    </div>
  </div>
</template>
