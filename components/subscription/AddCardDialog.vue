<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

// What the app says when the end of the trial gets in the way, as a dialog
// rather than a bar: once a day to the owner of an account whose trial has
// ended ('grace') or that has turned read-only ('read_only'), and to anyone
// whose change was just refused because it is read-only ('refused').
//
// The owner is sent to Subscription, where adding the card is one button;
// anyone else is told who can do it.
const props = defineProps<{ mode: 'grace' | 'read_only' | 'refused' }>()
const emit = defineEmits<{ close: [] }>()

const store = useAccountStore()
const t = useT()

const endedOn = computed(() => (store.trialEndsAt ? formatLongDate(store.trialEndsAt) : null))
const graceEndsOn = computed(() => (store.graceEndsAt ? formatLongDate(store.graceEndsAt) : null))

const title = computed(() =>
  props.mode === 'grace'
    ? t('Your free trial has ended', 'Tu prueba gratuita ha terminado')
    : t('Your account is read-only', 'Tu cuenta está en modo solo lectura'),
)

function confirm() {
  emit('close')
  if (store.isOwner) navigateTo('/subscription')
}
</script>

<template>
  <UiConfirmDialog
    :title="title"
    :confirm-label="store.isOwner ? t('Add a card', 'Añadir tarjeta') : t('Understood', 'Entendido')"
    :cancel-label="store.isOwner ? t('Not now', 'Ahora no') : t('Close', 'Cerrar')"
    data-cy="add-card-dialog"
    @confirm="confirm"
    @cancel="emit('close')"
  >
    <div class="flex flex-col gap-2.5 text-[14px] leading-[1.55] text-ink-700" data-cy="add-card-dialog-body">
      <template v-if="mode === 'grace'">
        <p>
          <template v-if="endedOn">{{ t(`It ended on ${endedOn}.`, `Terminó el ${endedOn}.`) + ' ' }}</template>
          <template v-if="graceEndsOn">
            {{ t('Everything keeps working until', 'Todo sigue funcionando hasta el') }}
            <strong class="font-semibold text-ink-900">{{ graceEndsOn }}</strong>.
          </template>
        </p>
        <p>
          {{
            t(
              'After that the account becomes read-only: you can still see and export everything, but not create or change appointments, patients, notes or invoices, and online booking pauses.',
              'Después, la cuenta pasará a modo solo lectura: podrás consultar y exportar todo, pero no crear ni modificar citas, pacientes, notas ni facturas, y las reservas online se pausarán.',
            )
          }}
        </p>
        <p v-if="store.isOwner && endedOn">
          {{ t(`Billing counts from ${endedOn}, the day the trial ended.`, `El pago cuenta desde el ${endedOn}, el día que terminó la prueba.`) }}
        </p>
      </template>
      <template v-else>
        <p v-if="mode === 'refused'">{{ t('That change was not saved.', 'Ese cambio no se ha guardado.') }}</p>
        <p>
          {{
            t(
              'The account can no longer create or change appointments, patients, notes or invoices, and online booking is paused. Your data is all still there: you can see it and export it.',
              'La cuenta ya no permite crear ni modificar citas, pacientes, notas ni facturas, y las reservas online están en pausa. Tus datos siguen ahí: puedes consultarlos y exportarlos.',
            )
          }}
        </p>
        <p>
          {{
            store.isOwner
              ? t('Add a card and everything works again straight away.', 'Añade una tarjeta y todo vuelve a funcionar al momento.')
              : t('The account owner can reactivate it by adding a card in Subscription.', 'La persona titular de la cuenta puede reactivarla añadiendo una tarjeta en Suscripción.')
          }}
        </p>
      </template>
    </div>
  </UiConfirmDialog>
</template>
