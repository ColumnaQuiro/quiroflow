<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { bonoVisitChargeCents } from '../../utils/visitCharging'
import { readInstallmentOptions } from '../../utils/bonoInstallments'
import { bonoSaleDefaultCents, specialBonoPriceCents } from '../../utils/bonoSale'

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
  /** When they were checked in and when the slot starts, so arriving early offers the checkout at once. */
  checkedInAt?: string | null
  startsAt?: string
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
  loadAppointmentTiming,
  loadInvoice,
  refresh: refreshMoney,
  chargeVisit,
  visitMissing,
  usePackageSession,
  bonoTemplates,
  loadBonoTemplates,
  canSellBono,
  sellBonoForVisit,
  sellNextBono,
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

// Checking in from this panel does not remount it (it is keyed by the
// appointment), and whether the visit is still "upcoming" was read once, on
// open. A patient checked in before their slot's start therefore got no
// checkout until the panel was closed and reopened. Read it again whenever the
// arrival or the start time changes: checking in, undoing the arrival, moving
// the appointment.
watch(
  () => [props.checkedInAt ?? null, props.startsAt ?? null],
  async () => {
    if (!ready.value) return
    await loadAppointmentTiming()
  },
)

// What the money option would collect: what is left on the receipt this visit
// already has, or the type's price when nothing has been raised yet. A receipt
// missing the visit itself (raised while the type cost 0 €) gets the visit
// added when this is pressed, so it is quoted with it.
const dueCents = computed(() =>
  invoice.value ? balanceDueCents.value + (visitMissing.value ? visitPriceCents.value : 0) : visitPriceCents.value,
)
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

// 'money', 'sell', the id of the bono to draw from, or '' when nothing is picked
// yet. A patient holding one bono has already paid for this visit, so that bono
// is what opens selected; holding two or more (their own and a shared one, say),
// none is -- the front desk picks (utils/bonoOrder checkoutDefaultChoice).
const choice = ref<string>('money')
const chosen = ref(false)
watch(
  [activePackages, ready],
  () => {
    if (chosen.value) return
    choice.value = checkoutDefaultChoice(activePackages.value)
  },
  { immediate: true },
)
function pick(value: string) {
  chosen.value = true
  choice.value = value
  if (value === 'sell' && bonoTemplates.value.length === 0) void loadBonoTemplates()
}

// Selling a bono here, with this visit as its first session: the patient's
// Billing tab's sale form, in the checkout (useVisitCharging.sellBonoForVisit).
const sellId = ref('')
const sellInstallments = ref(1)
const sellAmount = ref('')
// The price, at once: the bono's own unless reception gives a discount.
const sellPrice = ref('')
const sellMethod = ref('cash')
const sellTemplate = computed(() => bonoTemplates.value.find((b) => b.id === sellId.value) ?? null)
const sellOptions = computed(() => (sellTemplate.value ? readInstallmentOptions(sellTemplate.value.installment_options) : []))
const sellAmountCents = computed(() => Math.round((parseFloat(sellAmount.value) || 0) * 100))
const sellSpecialPriceCents = computed(() =>
  sellTemplate.value && sellInstallments.value === 1 ? specialBonoPriceCents(sellTemplate.value.price_cents, sellPrice.value) : null,
)
// What the bono costs in all, the way it is being paid: the rest of it stays
// owed on the bono, and the form says so.
const sellTotalCents = computed(() => {
  const option = sellOptions.value.find((o) => o.installments === sellInstallments.value)
  return option ? option.installments * option.installmentCents : (sellSpecialPriceCents.value ?? sellTemplate.value?.price_cents ?? 0)
})
function prefillSale() {
  const cents = bonoSaleDefaultCents(sellTemplate.value, sellInstallments.value)
  sellAmount.value = sellTemplate.value ? (cents / 100).toFixed(2) : ''
  sellPrice.value = sellTemplate.value ? (sellTemplate.value.price_cents / 100).toFixed(2) : ''
}
// A discount is usually paid in full there and then: what is taken now
// follows the price, so the bono is not left owing the discount.
watch(sellPrice, (value) => {
  if (sellTemplate.value && sellInstallments.value === 1) sellAmount.value = value
})
watch(sellId, () => {
  sellInstallments.value = 1
  sellMethod.value = method.value !== 'credit' ? method.value : (paymentMethods.value[0]?.key ?? 'cash')
  prefillSale()
})
watch(sellInstallments, prefillSale)

// The visit that uses up a bono is paid by it, so the checkout above is gone
// by then -- and with it its "Sell a bono", at exactly the moment a patient
// decides to buy the next one. Offered when this visit drew from a bono and
// none of theirs has a session left; the bono is sold as it would be on the
// record, and its first session is the next visit's (sellNextBono).
const nextBonoOffered = computed(
  () => ready.value && !offered.value && canSellBono.value && !!packageCoverage.value && activePackages.value.length === 0,
)
const nextBonoOpen = ref(false)
const nextBonoSold = ref<string | null>(null)
function openNextBono() {
  nextBonoOpen.value = true
  if (bonoTemplates.value.length === 0) void loadBonoTemplates()
}
async function sellNext() {
  if (!sellTemplate.value || saving.value) return
  const sold = await sellNextBono({ packageId: sellTemplate.value.id, installments: sellInstallments.value, amountCents: sellAmountCents.value, priceCents: sellSpecialPriceCents.value, method: sellMethod.value })
  if (!sold) return
  nextBonoSold.value = sold.package_name
  nextBonoOpen.value = false
  sellId.value = ''
  emit('completed')
}

const selectedPackage = computed(() => activePackages.value.find((p) => p.id === choice.value) ?? null)
const buttonLabel = computed(() => {
  if (saving.value || processing.value) return t('Processing…', 'Procesando…')
  if (selectedPackage.value) return t(`Process · 1 session of ${selectedPackage.value.package_name}`, `Procesar · 1 sesión de ${selectedPackage.value.package_name}`)
  if (choice.value === '') return t('Process · choose a bono', 'Procesar · elige un bono')
  if (choice.value === 'sell') {
    return sellTemplate.value
      ? t(`Process · sell ${sellTemplate.value.name}, use 1 session`, `Procesar · vender ${sellTemplate.value.name} y usar 1 sesión`)
      : t('Process · choose a bono', 'Procesar · elige un bono')
  }
  return t(`Process · charge ${formatEur(dueCents.value)}`, `Procesar · cobrar ${formatEur(dueCents.value)}`)
})

async function process() {
  if (saving.value || processing.value) return
  // Nothing picked: without this the press fell through to charging in money.
  if (choice.value === '') return
  if (choice.value === 'sell' && !sellTemplate.value) return
  if (choice.value !== 'sell' && !selectedPackage.value && !canTakeMoney.value) {
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
  if (choice.value === 'sell') {
    if (!sellTemplate.value) return
    const sold = await sellBonoForVisit({ packageId: sellTemplate.value.id, installments: sellInstallments.value, amountCents: sellAmountCents.value, priceCents: sellSpecialPriceCents.value, method: sellMethod.value })
    // Sold but its session not taken (the payment failed): the bono is on the
    // list now, so the next press takes its session -- not a second sale.
    if (sold && activePackages.value.some((p) => p.id === sold)) choice.value = sold
    if (sold) sellId.value = ''
    return
  }
  if (selectedPackage.value) {
    await usePackageSession(selectedPackage.value)
    return
  }
  // Raise the receipt if the visit has none, then pay what is due on it in
  // full by the method chosen: the tab's "Charge" and "Process", in one press.
  if (!invoice.value || visitMissing.value) await chargeVisit()
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

      <div v-if="canSellBono" class="rounded-ctl border" :class="choice === 'sell' ? 'border-brand bg-brand-tint' : 'border-line-control hover:bg-surface-subtle'">
        <button type="button" role="radio" :aria-checked="choice === 'sell'" data-cy="checkout-sell-bono" :disabled="saving || processing" class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left" @click="pick('sell')">
          <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" :class="choice === 'sell' ? 'border-brand' : 'border-line-control'" aria-hidden="true">
            <span v-if="choice === 'sell'" class="h-2 w-2 rounded-full bg-brand" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-[14px] font-semibold text-ink-900">{{ activePackages.length > 0 ? t('Sell a new bono', 'Vender un bono nuevo') : t('Sell a bono', 'Vender un bono') }}</span>
            <span class="text-[12.5px] text-ink-muted">{{ t('This visit is its first session', 'Esta visita es su primera sesión') }}</span>
          </span>
        </button>
        <CalendarBonoSaleFields
          v-if="choice === 'sell'"
          v-model:id="sellId"
          v-model:installments="sellInstallments"
          v-model:amount="sellAmount"
          v-model:price="sellPrice"
          v-model:method="sellMethod"
          class="px-3.5 pb-3 pl-[2.85rem]"
          :templates="bonoTemplates"
          :template="sellTemplate"
          :options="sellOptions"
          :amount-cents="sellAmountCents"
          :total-cents="sellTotalCents"
          :special-price-cents="sellSpecialPriceCents"
          :payment-methods="paymentMethods"
          :spendable-credit-cents="spendableCreditCents"
          :disabled="saving || processing"
        />
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" data-cy="checkout-process" :disabled="saving || processing || choice === '' || (choice === 'sell' && !sellTemplate)" class="flex h-10 touch:h-12 items-center rounded-ctl bg-brand px-4 text-[14px] font-bold text-brand-on hover:bg-brand-hover disabled:opacity-60" @click="process">
        {{ buttonLabel }}
      </button>
      <button type="button" data-cy="checkout-details" class="h-9 touch:h-11 text-[12.5px] font-medium text-ink-muted underline-offset-2 hover:underline" @click="emit('details')">
        {{ t('Add services or split the payment', 'Añadir servicios o dividir el pago') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[13px] text-danger-text" data-cy="checkout-error">{{ error }}</p>
  </section>
  <section v-else-if="nextBonoOffered || nextBonoSold" data-cy="next-bono">
    <h3 class="mb-2.5 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Bono used up', 'Bono terminado') }}</h3>
    <p v-if="nextBonoSold" class="rounded-ctl border border-success-border bg-success-bg px-3.5 py-2.5 text-[13px] font-semibold text-success-text" data-cy="next-bono-sold">
      {{ t(`${nextBonoSold} sold. Its first session is the next visit.`, `${nextBonoSold} vendido. Su primera sesión será la próxima visita.`) }}
    </p>
    <div v-else class="rounded-ctl border border-line-control px-3.5 py-3">
      <div class="flex flex-wrap items-center gap-3">
        <span class="min-w-0 flex-1 text-[13px] text-ink-700">{{ t('No bono sessions left after this visit.', 'Después de esta visita no le quedan sesiones de bono.') }}</span>
        <button v-if="!nextBonoOpen" type="button" data-cy="next-bono-open" class="flex h-9 touch:h-11 shrink-0 items-center rounded-ctl bg-brand px-3.5 text-[13.5px] font-bold text-brand-on hover:bg-brand-hover" @click="openNextBono">
          {{ t('Sell a new bono', 'Vender bono nuevo') }}
        </button>
      </div>
      <template v-if="nextBonoOpen">
        <CalendarBonoSaleFields
          v-model:id="sellId"
          v-model:installments="sellInstallments"
          v-model:amount="sellAmount"
          v-model:price="sellPrice"
          v-model:method="sellMethod"
          class="mt-3"
          :templates="bonoTemplates"
          :template="sellTemplate"
          :options="sellOptions"
          :amount-cents="sellAmountCents"
          :total-cents="sellTotalCents"
          :special-price-cents="sellSpecialPriceCents"
          :payment-methods="paymentMethods"
          :spendable-credit-cents="spendableCreditCents"
          :disabled="saving"
        />
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" data-cy="next-bono-sell" :disabled="saving || !sellTemplate" class="flex h-10 touch:h-12 items-center rounded-ctl bg-brand px-4 text-[14px] font-bold text-brand-on hover:bg-brand-hover disabled:opacity-60" @click="sellNext">
            {{ saving ? t('Selling…', 'Vendiendo…') : sellTemplate ? t(`Sell ${sellTemplate.name}`, `Vender ${sellTemplate.name}`) : t('Choose a bono', 'Elige un bono') }}
          </button>
          <button type="button" class="h-9 touch:h-11 rounded-ctl px-3 text-[13px] font-semibold text-ink-muted hover:bg-surface-subtle" :disabled="saving" @click="nextBonoOpen = false">{{ t('Cancel', 'Cancelar') }}</button>
        </div>
      </template>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[13px] text-danger-text" data-cy="checkout-error">{{ error }}</p>
  </section>
  <!-- The session was taken but its charge failed: the card is gone by then
       (the visit is covered), and the warning still has to be read. -->
  <p v-else-if="error" role="alert" class="rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text" data-cy="checkout-error">{{ error }}</p>
</template>
