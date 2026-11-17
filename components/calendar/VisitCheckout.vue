<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { bonoVisitChargeCents } from '../../utils/visitCharging'

// The visit's checkout, on the panel's first screen: how it is paid, already
// chosen, and one button.
//
// Clinics coming from PracticeHub process a visit in two clicks -- open it,
// press Process, with the bono already ticked. Here the same thing was the
// panel's five-step track (Check in, Into session, To checkout, Charge) ending
// in a button that only switched to the Cobro tab, where the bono was a sixth
// click. The short way existed, straight to the tab, but nothing on the first
// screen said so, and a new clinic read the track as compulsory.
//
// This is the same choice the Cobro tab offers, over the same composable, so
// the two cannot charge differently. Nothing is written until the button is
// pressed -- see useVisitCharging's ensureInvoice for what writing on open
// cost. The tab stays for what does not fit in one line: extra services, a
// payment split across methods, sending the receipt.

const props = defineProps<{
  appointmentId: string
  patientId: string
  appointmentTypeName?: string
  appointmentTypePriceCents?: number
  /** The appointment's status, so an undone visit is offered again. */
  status?: string
}>()
const emit = defineEmits<{ completed: []; details: []; offered: [value: boolean] }>()

const store = useAccountStore()
const { can } = usePermission()
const t = useT()

const {
  activePackages,
  spendableCreditCents,
  invoice,
  appointmentIsUpcoming,
  packageCoverage,
  saving,
  error,
  balanceDueCents,
  visitPriceCents,
  paymentMethods,
  paymentRows,
  init,
  loadInvoice,
  refresh: refreshMoney,
  chargeVisit,
  usePackageSession,
  recordPayment,
} = useVisitCharging({
  appointmentId: () => props.appointmentId,
  patientId: () => props.patientId,
  appointmentTypeName: () => props.appointmentTypeName,
  appointmentTypePriceCents: () => props.appointmentTypePriceCents,
  accountId: () => store.accountId,
  teamMemberId: () => store.teamMember?.id ?? null,
  can,
  onCompleted: () => emit('completed'),
})

const ready = ref(false)
const method = ref('cash')
onMounted(async () => {
  await init()
  // The method the form opens on is the account's default (init sets it).
  method.value = paymentRows.value[0]?.method ?? 'cash'
  ready.value = true
})

// "Undo visit" gives the bono session back and voids its charge from outside
// this component (undo_visit). What was read before that says the visit is
// covered, so read it again: without this the visit stayed off the screen
// until the panel was closed and reopened.
watch(
  () => props.status,
  async (now, before) => {
    if (before !== 'completed' || now !== 'booked' || !ready.value) return
    chosen.value = false
    await loadInvoice()
    await refreshMoney()
  },
)

// What the money option would collect: what is left on the receipt this visit
// already has, or the type's price when nothing has been raised yet.
const dueCents = computed(() => (invoice.value ? balanceDueCents.value : visitPriceCents.value))
const canTakeMoney = computed(() => can('payments_allocate') && dueCents.value > 0)

// Offered once the visit can be charged and has not been: the same conditions
// the Cobro tab applies before it shows its buttons.
//
// Held while a press is being processed. Charging in money is two writes with
// a reload of the receipt between them, and reading that reload as "not
// offered" took the block off the screen halfway through: the button vanished
// before the payment existed, which reads as done when it is not.
const processing = ref(false)
const offered = computed(
  () =>
    ready.value &&
    (processing.value || chargeable.value),
)
const chargeable = computed(
  () =>
    can('billing_access') &&
    !packageCoverage.value &&
    invoice.value?.status !== 'paid' &&
    invoice.value?.status !== 'void' &&
    !(appointmentIsUpcoming.value && !invoice.value) &&
    (activePackages.value.length > 0 || canTakeMoney.value),
)
watch(offered, (v) => emit('offered', v), { immediate: true })

// 'money', or the id of the bono to draw from. A patient holding a bono has
// already paid for this visit, so the bono is what opens selected.
const choice = ref<string>('money')
const chosen = ref(false)
watch(
  [activePackages, ready],
  () => {
    if (chosen.value) return
    choice.value = activePackages.value[0]?.id ?? 'money'
  },
  { immediate: true },
)
function pick(value: string) {
  chosen.value = true
  choice.value = value
}

const selectedPackage = computed(() => activePackages.value.find((p) => p.id === choice.value) ?? null)
const buttonLabel = computed(() => {
  if (saving.value || processing.value) return t('Processing…', 'Procesando…')
  if (selectedPackage.value) return t(`Process · 1 session of ${selectedPackage.value.package_name}`, `Procesar · 1 sesión de ${selectedPackage.value.package_name}`)
  return t(`Process · charge ${formatEur(dueCents.value)}`, `Procesar · cobrar ${formatEur(dueCents.value)}`)
})

async function process() {
  if (saving.value || processing.value) return
  if (!selectedPackage.value && !canTakeMoney.value) {
    emit('details')
    return
  }
  processing.value = true
  try {
    await charge()
  } finally {
    processing.value = false
  }
}
async function charge() {
  if (selectedPackage.value) {
    await usePackageSession(selectedPackage.value)
    return
  }
  // Raise the receipt if the visit has none, then pay what is due on it in
  // full by the method chosen: the tab's "Charge" and "Process", in one press.
  if (!invoice.value) await chargeVisit()
  if (!invoice.value || balanceDueCents.value <= 0) return
  paymentRows.value = [{ method: method.value, amount: (balanceDueCents.value / 100).toFixed(2) }]
  await recordPayment()
}
</script>

<template>
  <section v-if="offered" data-cy="visit-checkout">
    <h3 class="mb-2.5 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">
      {{ t('Charge this visit', 'Cobro de esta visita') }}<span v-if="dueCents > 0" class="font-mono font-medium normal-case tracking-normal"> · {{ formatEur(dueCents) }}</span>
    </h3>
    <div role="radiogroup" :aria-label="t('How this visit is paid', 'Cómo se paga esta visita')" class="flex flex-col gap-2">
      <button
        v-for="p in activePackages"
        :key="p.id"
        type="button"
        role="radio"
        :aria-checked="choice === p.id"
        data-cy="checkout-bono"
        :disabled="saving || processing"
        class="flex items-center gap-3 rounded-ctl border px-3.5 py-2.5 text-left"
        :class="choice === p.id ? 'border-brand bg-brand-tint' : 'border-line-control hover:bg-surface-subtle'"
        @click="pick(p.id)"
      >
        <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="choice === p.id ? 'border-brand' : 'border-line-control'" aria-hidden="true">
          <span v-if="choice === p.id" class="h-2 w-2 rounded-full bg-brand" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="text-[14px] font-semibold text-ink-900">
            {{ p.package_name }}
            <UiPill v-if="p.shared" tone="info" class="ml-1">
              {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
            </UiPill>
          </span>
          <span class="text-[12.5px] text-ink-muted">
            {{
              t(
                `${p.sessions_total - p.sessions_used} left, ${p.sessions_total - p.sessions_used - 1} after this visit`,
                `Quedan ${p.sessions_total - p.sessions_used}, pasará a ${p.sessions_total - p.sessions_used - 1}`,
              )
            }}
            <template v-if="p.sessions_total"> · {{ p.charged_at_purchase ? t('already paid', 'ya pagado') : formatEur(bonoVisitChargeCents(p)) }}</template>
          </span>
        </span>
      </button>

      <div v-if="canTakeMoney" class="rounded-ctl border" :class="choice === 'money' ? 'border-brand bg-brand-tint' : 'border-line-control hover:bg-surface-subtle'">
        <button type="button" role="radio" :aria-checked="choice === 'money'" data-cy="checkout-money" :disabled="saving || processing" class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left" @click="pick('money')">
          <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="choice === 'money' ? 'border-brand' : 'border-line-control'" aria-hidden="true">
            <span v-if="choice === 'money'" class="h-2 w-2 rounded-full bg-brand" />
          </span>
          <span class="text-[14px] font-semibold text-ink-900">
            {{ activePackages.length > 0 ? t(`No bono, charge ${formatEur(dueCents)}`, `Sin bono, cobrar ${formatEur(dueCents)}`) : t(`Charge ${formatEur(dueCents)}`, `Cobrar ${formatEur(dueCents)}`) }}
          </span>
        </button>
        <label v-if="choice === 'money'" class="flex items-center gap-2 px-3.5 pb-3 pl-[2.85rem] text-[12.5px] font-medium text-ink-600">
          {{ t('Method', 'Método') }}
          <select v-model="method" data-cy="checkout-method" :disabled="saving || processing" class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
            <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
            <option v-if="spendableCreditCents >= dueCents" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} ({{ formatEur(spendableCreditCents) }} {{ t('available', 'disponible') }})</option>
          </select>
        </label>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" data-cy="checkout-process" :disabled="saving || processing" class="flex h-10 touch:h-12 items-center rounded-ctl bg-brand px-4 text-[14px] font-bold text-brand-on hover:bg-brand-hover disabled:opacity-60" @click="process">
        {{ buttonLabel }}
      </button>
      <button type="button" data-cy="checkout-details" class="h-9 touch:h-11 text-[12.5px] font-medium text-ink-muted underline-offset-2 hover:underline" @click="emit('details')">
        {{ t('Add services or split the payment', 'Añadir servicios o dividir el pago') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[13px] text-danger-text" data-cy="checkout-error">{{ error }}</p>
  </section>
  <!-- The session was taken but its charge failed: the card is gone by then
       (the visit is covered), and the warning still has to be read. -->
  <p v-else-if="error" role="alert" class="rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text" data-cy="checkout-error">{{ error }}</p>
</template>
