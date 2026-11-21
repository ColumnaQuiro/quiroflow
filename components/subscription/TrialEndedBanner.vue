<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

// The trial banner's sequel, on Subscription: the trial has ended with no
// card. 'grace' -- everything still works until the date shown, and the
// payment counts from the day the trial ended (graceBackdate); 'read_only' --
// the account only reads until a card goes on. One button, the same Checkout
// the trial banner opens.
const props = defineProps<{ mode: 'grace' | 'read_only'; trialEndsAt: string | null; graceEndsAt: Date | null; busy?: boolean }>()
defineEmits<{ addCard: [] }>()

const t = useT()
const endedOn = computed(() => (props.trialEndsAt ? formatLongDate(props.trialEndsAt) : null))
const graceEndsOn = computed(() => (props.graceEndsAt ? formatLongDate(props.graceEndsAt) : null))
</script>

<template>
  <div class="rounded-card border border-danger-border bg-danger-bg p-[18px]" data-cy="trial-ended-banner">
    <div class="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:gap-4">
      <div class="flex-1">
        <h2 class="text-[16px] font-semibold text-ink-900">
          {{ mode === 'grace' ? t('Your free trial has ended', 'Tu prueba gratuita ha terminado') : t('Your account is read-only', 'Tu cuenta está en modo solo lectura') }}
        </h2>
        <p v-if="mode === 'grace'" class="mt-2 text-[13px] leading-[1.55] text-ink-700">
          <template v-if="endedOn">{{ t(`It ended on ${endedOn}.`, `Terminó el ${endedOn}.`) + ' ' }}</template>
          <template v-if="graceEndsOn">
            {{ t('Everything keeps working until', 'Todo sigue funcionando hasta el') }}
            <strong class="font-semibold text-ink-900">{{ graceEndsOn }}</strong>;
            {{ t('after that the account becomes read-only.', 'después, la cuenta pasará a modo solo lectura.') + ' ' }}
          </template>
          <template v-if="endedOn">
            {{ t(`The first payment counts from ${endedOn}, the day the trial ended.`, `El primer pago cuenta desde el ${endedOn}, el día que terminó la prueba.`) }}
          </template>
        </p>
        <p v-else class="mt-2 text-[13px] leading-[1.55] text-ink-700">
          {{
            t(
              'You can still see and export everything, but not create or change appointments, patients, notes or invoices, and online booking is paused. Add a card and everything works again straight away.',
              'Puedes consultar y exportar todo, pero no crear ni modificar citas, pacientes, notas ni facturas, y las reservas online están en pausa. Añade una tarjeta y todo vuelve a funcionar al momento.',
            )
          }}
        </p>
      </div>
      <button
        type="button"
        class="flex h-9 touch:h-11 items-center justify-center gap-1.5 rounded-ctl bg-brand px-3.5 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus disabled:opacity-60 lg:h-[34px]"
        :disabled="busy"
        data-cy="trial-ended-add-card"
        @click="$emit('addCard')"
      >
        {{ t('Add payment method', 'Añadir método de pago') }}
      </button>
    </div>
  </div>
</template>
