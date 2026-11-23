<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { bonoVisitChargeCents, SPECIAL_PRICE_REASONS } from '../../utils/visitCharging'
import { parseEurosToCents } from '../../utils/appointmentTypes'
import type { VisitLineItem } from '../../composables/useVisitCharging'
const props = defineProps<{
  appointmentId: string
  patientId: string
  appointmentTypeName?: string
  appointmentTypePriceCents?: number
}>()

const emit = defineEmits<{ completed: [] }>()

const store = useAccountStore()
const { can } = usePermission()
const t = useT()

// Every write this tab makes -- the invoice, its lines, a bono session, the
// payments, facturas and credit spend, settling, completing the visit and the
// automations -- lives in useVisitCharging, shared with the staff app's visit
// screen so the two cannot drift apart again. This file is the web's panel
// over it.
const {
  loading: summaryLoading,
  balanceCents,
  outstandingCents,
  availableCents,
  spendableCreditCents,
  activeMembership,
  activePackages,
  invoice,
  lineItems,
  payments,
  services,
  addServiceId,
  loadingInvoice,
  appointmentIsUpcoming,
  packageCoverage,
  otherReceipts,
  saving: savingPayment,
  error,
  paidCents,
  balanceDueCents,
  visitPriceCents,
  paymentMethods,
  paymentRows,
  addPaymentRow,
  removePaymentRow,
  paymentTotalCents,
  sendingInvoice,
  sendResult,
  sendInvoiceEmail,
  init,
  chargeVisit,
  receiptEditable,
  visitMissing,
  addVisitLine,
  addLineItem,
  removeLineItem,
  canChangeLinePrice,
  changeLinePrice,
  usePackageSession,
  recordPayment,
  afterThirdPartyChange,
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

onMounted(init)

// An appointment type with no price of its own (the visit is billed from the
// services added to it) would otherwise offer "Charge €0.00".
// The rate a bono button quotes, rounded the way usePackageSession rounds
// what it actually bills, so the button and the charge cannot disagree.
// A bono invoiced in full when it was sold has nothing left to charge per
// visit, and says so rather than quoting a rate (bonoVisitChargeCents).
function perSessionLabel(p: { price_cents: number; sessions_total: number; charged_at_purchase?: boolean }): string {
  if (!p.sessions_total) return '—'
  if (p.charged_at_purchase) return t('already paid', 'ya pagado')
  return `${formatEur(bonoVisitChargeCents(p))}`
}

const chargeLabel = computed(() =>
  visitPriceCents.value > 0
    ? `${t('Charge', 'Cobrar')} ${formatEur(visitPriceCents.value)}`
    : t('Charge this visit', 'Cobrar esta visita'),
)

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()

// A special price on the visit -- seniors, students, disability -- set on the
// open receipt before it is charged (useVisitCharging changeLinePrice). One
// line at a time, inline under it.
const priceEditLineId = ref<string | null>(null)
const priceInput = ref('')
const priceReason = ref<string>('')
const priceReasonOther = ref('')

/** What the line cost before any special price. */
function normalPriceCents(line: VisitLineItem): number {
  return line.list_price_cents ?? line.price_cents * line.quantity
}

function openPriceEditor(line: VisitLineItem) {
  priceEditLineId.value = line.id
  const known = SPECIAL_PRICE_REASONS.some((r) => r.value === line.price_change_reason)
  priceReason.value = line.price_change_reason ? (known ? line.price_change_reason : 'other') : ''
  priceReasonOther.value = line.price_change_reason && !known ? line.price_change_reason : ''
  priceInput.value = line.list_price_cents != null ? (line.price_cents / 100).toFixed(2).replace('.', ',') : ''
  nextTick(() => (document.getElementById(`${fieldId}-special-price`) as HTMLInputElement | null)?.focus())
}

function closePriceEditor() {
  priceEditLineId.value = null
}

const newPriceCents = computed(() => {
  const cents = parseEurosToCents(priceInput.value)
  return cents != null && Number.isFinite(cents) && cents >= 0 ? cents : null
})
const priceReasonText = computed(() => (priceReason.value === 'other' ? priceReasonOther.value.trim() : priceReason.value))

function priceEditReady(line: VisitLineItem): boolean {
  if (newPriceCents.value == null) return false
  // Back to the normal price undoes the special one, and needs no reason.
  if (line.list_price_cents != null && newPriceCents.value === line.list_price_cents) return true
  return priceReasonText.value.length > 0
}

async function savePrice(line: VisitLineItem) {
  if (!priceEditReady(line) || newPriceCents.value == null) return
  if (await changeLinePrice(line, newPriceCents.value, priceReasonText.value || null)) closePriceEditor()
}

async function restoreNormalPrice(line: VisitLineItem) {
  if (line.list_price_cents == null) return
  if (await changeLinePrice(line, line.list_price_cents, null)) closePriceEditor()
}
</script>

<template>
  <div class="space-y-4 text-[13px]">
    <div class="rounded-card border border-line bg-surface-subtle p-3">
      <div v-if="summaryLoading" class="space-y-2" aria-busy="true" :aria-label="t('Loading patient summary…', 'Cargando resumen del paciente…')">
        <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
        <UiSkeleton class="h-4 w-56 rounded-ctlSm" />
      </div>
      <div v-else class="space-y-1.5">
        <p class="flex items-center gap-1.5">
          <span class="text-ink-muted2">{{ t('Balance:', 'Saldo:') }}</span>
          <UiBalancePill :available-cents="availableCents" :outstanding-cents="outstandingCents" />
          <span v-if="balanceCents === 0" class="font-mono font-medium text-ink-700">{{ formatEur(0) }}</span>
        </p>
        <p v-if="activeMembership">
          <span class="text-ink-muted2">{{ t('Membership:', 'Membresía:') }}</span>
          <span class="ml-1 font-medium text-ink-900">{{ activeMembership.membership_name }}</span>
          <UiPill tone="success" class="ml-1">{{ t('active', 'activa') }}</UiPill>
        </p>
        <p v-else class="text-ink-faint">{{ t('No active membership', 'Sin membresía activa') }}</p>
        <div v-if="activePackages.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-ink-muted2">{{ t('Bonos:', 'Bonos:') }}</span>
          <template v-for="p in activePackages" :key="p.id">
            <UiPill tone="brand">
              {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}
              <UiPill
                v-if="p.shared"
                tone="info"
                class="-my-0.5 -mr-1.5 border border-info-border"
                :title="p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido')"
              >
                {{ t('Shared', 'Compartido') }}
              </UiPill>
            </UiPill>
            <!-- Money still owed on the bono -- paid half, owes half -- so the
            front desk sees it at the visit rather than only on the patient's
            Billing tab. Due, not merely owed: a plazo not yet due is not a
            debt, the same rule the Billing tab's card and Debtors apply. -->
            <UiPill
              v-if="!p.shared && (p.dueCents ?? 0) > 0"
              tone="danger"
              data-cy="appointment-bono-owed"
              :title="t(`Still owed on ${p.package_name}`, `Pendiente de pago en ${p.package_name}`)"
            >
              {{ formatEur(p.dueCents ?? 0) }} {{ t('owed', 'pendiente') }}
            </UiPill>
          </template>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="space-y-2 rounded-card border border-line bg-surface p-3" aria-busy="true" :aria-label="t('Loading receipt…', 'Cargando recibo…')">
      <UiSkeleton class="h-4 w-28 rounded-ctlSm" />
      <UiSkeleton class="h-4 w-full rounded-ctlSm" />
      <UiSkeleton class="ml-auto h-4 w-36 rounded-ctlSm" />
    </div>
    <p v-else-if="!invoice && appointmentIsUpcoming" class="text-ink-faint">
      {{ t("This appointment hasn't happened yet — no receipt until it does.", 'Esta cita todavía no ha ocurrido: no habrá recibo hasta entonces.') }}
    </p>
    <p v-else-if="!invoice && !can('billing_access')" class="text-ink-faint">{{ t('No receipt for this appointment yet.', 'Todavía no hay recibo para esta cita.') }}</p>
    <!-- Covered by a bono and nothing extra was added, so there is no invoice
    to show. Say so explicitly: an empty panel reads as something failing. -->
    <div v-else-if="!invoice && packageCoverage" class="rounded-card border border-line bg-surface p-3">
      <p class="text-[13px] font-medium text-ink-700">
        {{ t('Covered by', 'Cubierta por') }} {{ packageCoverage.packageName || t('a bono', 'un bono') }}
      </p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted2">
        {{ t('Worth', 'Valor') }} {{ formatEur(packageCoverage.amountCents) }} —
        {{ t('paid when the bono was bought.', 'pagada al comprar el bono.') }}
      </p>
    </div>
    <!-- Past visit, nothing billed against it yet. This is the choice that
    used to be made for reception by ensureInvoice() running on open: charge
    the visit, or spend a bono session. Until one is pressed, no invoice
    exists and nothing is owed. -->
    <div v-else-if="!invoice" class="rounded-card border border-line bg-surface p-3">
      <p class="text-[13px] font-medium text-ink-700">{{ t('Not charged yet', 'Sin cobrar') }}</p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted2">
        {{ appointmentTypeName || t('Appointment', 'Cita') }}<span v-if="visitPriceCents > 0"> — {{ formatEur(visitPriceCents) }}</span>
      </p>
      <!-- A patient holding a bono has already paid for this visit, so that
      is the action rather than the footnote it used to be: the filled button
      was "Charge EUR 55.00" and the bono a small "Or use a package session:"
      line beneath it, so the obvious click charged a bono patient the walk-in
      price on top of the bono they had already bought. Each button states the
      rate it will charge -- the bono's -- so the two can be compared before
      either is pressed. -->
      <div v-if="activePackages.length > 0" class="mt-2 flex flex-wrap items-center gap-2">
        <UiBtn
          v-for="p in activePackages"
          :key="p.id"
          variant="primary"
          class="!h-auto min-h-9 !whitespace-normal py-1.5 text-left touch:min-h-11"
          :disabled="savingPayment"
          @click="usePackageSession(p)"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : `${t('Use', 'Usar')} ${p.package_name} — ${perSessionLabel(p)}` }}
          <span class="font-normal opacity-80">({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})</span>
          <UiPill v-if="p.shared" tone="info" class="ml-1">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </UiPill>
        </UiBtn>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2" :class="activePackages.length > 0 ? 'border-t border-line-divider pt-2' : ''">
        <UiBtn
          :variant="activePackages.length > 0 ? 'secondary' : 'primary'"
          :disabled="savingPayment"
          @click="chargeVisit"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : activePackages.length > 0 ? `${chargeLabel} ${t('instead', 'en su lugar')}` : chargeLabel }}
        </UiBtn>
      </div>
    </div>
    <div v-else-if="invoice" class="rounded-card border border-line bg-surface p-3">
      <p v-if="packageCoverage" class="mb-2 border-b border-line-divider pb-2 text-[12.5px] text-ink-muted2">
        {{ t('Covered by', 'Cubierta por') }}
        <span class="font-medium text-ink-700">{{ packageCoverage.packageName || t('a bono', 'un bono') }}</span>
        — {{ t('charged at the bono rate against money already paid.', 'cargada a la tarifa del bono contra dinero ya pagado.') }}
      </p>
      <div class="flex items-center justify-between">
        <NuxtLink :to="`/billing/${invoice.id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ invoice.invoice_number }}</NuxtLink>
        <div class="flex items-center gap-2">
          <UiPill :tone="invoice.status === 'paid' ? 'success' : invoice.status === 'void' ? 'neutral' : 'danger'" data-cy="appt-receipt-status">
            {{ invoice.status === 'paid' ? t('Paid', 'Pagado') : invoice.status === 'void' ? t('Void', 'Anulado') : t('Unpaid', 'Sin pagar') }}
          </UiPill>
          <span v-if="sendResult" class="text-[12px] text-ink-muted">{{ sendResult }}</span>
          <button
            v-else-if="can('billing_access')"
            type="button"
            class="-my-1 flex h-8 items-center rounded-ctlSm px-2 text-[12.5px] font-medium text-brand-text hover:bg-brand-tint disabled:opacity-50 touch:h-11"
            :disabled="sendingInvoice"
            @click="sendInvoiceEmail"
          >
            {{ sendingInvoice ? t('Sending…', 'Enviando…') : t('Send receipt', 'Enviar recibo') }}
          </button>
        </div>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="text-ink-700">
          <div class="flex items-center justify-between gap-2">
            <span>{{ line.description }} &times;{{ line.quantity }}</span>
            <span class="flex shrink-0 items-center gap-1">
              <button
                v-if="canChangeLinePrice(line) && priceEditLineId !== line.id"
                type="button"
                data-cy="appt-line-change-price"
                class="-my-1 flex h-7 items-center rounded-ctlSm px-1.5 text-[12px] font-medium text-brand-text hover:bg-brand-tint touch:h-11"
                @click="openPriceEditor(line)"
              >
                {{ t('Change price', 'Cambiar precio') }}
              </button>
              <!-- The price it would have been, so a special price is never a
              mystery on the receipt. -->
              <s
                v-if="line.list_price_cents != null && line.list_price_cents !== line.price_cents * line.quantity"
                class="font-mono text-[12px] text-ink-faint"
                :title="t('Normal price', 'Precio normal')"
              >{{ formatEur(line.list_price_cents) }}</s>
              <span class="font-mono">{{ formatEur((line.price_cents * line.quantity)) }}</span>
              <button
                v-if="can('billing_access') && receiptEditable"
                type="button"
                :aria-label="t(`Remove ${line.description}`, `Quitar ${line.description}`)"
                :title="t('Remove', 'Quitar')"
                class="-my-1 -mr-1.5 flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-danger-bg hover:text-danger-text touch:h-11 touch:w-11"
                @click="removeLineItem(line)"
              >
                <UiCloseIcon />
              </button>
            </span>
          </div>
          <form
            v-if="priceEditLineId === line.id"
            class="mt-1.5 space-y-2 rounded-ctl border border-line bg-surface-subtle p-2.5"
            data-cy="appt-line-price-editor"
            @submit.prevent="savePrice(line)"
            @keydown.esc="closePriceEditor"
          >
            <div class="flex flex-wrap items-end gap-x-3 gap-y-1">
              <div>
                <label :for="`${fieldId}-special-price`" class="block text-[12px] font-medium text-ink-600">{{ t('Special price (€)', 'Precio especial (€)') }}</label>
                <input
                  :id="`${fieldId}-special-price`"
                  v-model="priceInput"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :placeholder="(normalPriceCents(line) / 100).toFixed(2).replace('.', ',')"
                  class="mt-1 h-9 w-24 rounded-ctl border border-line-control bg-surface px-2 font-mono text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11"
                />
              </div>
              <p class="pb-2 text-[12px] text-ink-muted2">{{ t('Normal price:', 'Precio normal:') }} <span class="font-mono">{{ formatEur(normalPriceCents(line)) }}</span></p>
            </div>
            <fieldset>
              <legend class="text-[12px] font-medium text-ink-600">{{ t('Reason', 'Motivo') }}</legend>
              <div class="mt-1 flex flex-wrap gap-1.5">
                <button
                  v-for="r in SPECIAL_PRICE_REASONS"
                  :key="r.value"
                  type="button"
                  :aria-pressed="priceReason === r.value"
                  class="h-7 rounded-pill border px-2.5 text-[12px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
                  :class="priceReason === r.value ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
                  @click="priceReason = r.value"
                >
                  {{ t(r.en, r.es) }}
                </button>
                <button
                  type="button"
                  :aria-pressed="priceReason === 'other'"
                  class="h-7 rounded-pill border px-2.5 text-[12px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
                  :class="priceReason === 'other' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
                  @click="priceReason = 'other'"
                >
                  {{ t('Other', 'Otro') }}
                </button>
              </div>
              <input
                v-if="priceReason === 'other'"
                v-model="priceReasonOther"
                type="text"
                maxlength="80"
                :aria-label="t('Reason for the special price', 'Motivo del precio especial')"
                :placeholder="t('Why this price? It shows on the receipt', '¿Por qué este precio? Sale en el recibo')"
                class="mt-1.5 h-9 w-full rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11"
              />
            </fieldset>
            <div class="flex flex-wrap items-center gap-2">
              <UiBtn type="submit" variant="primary" size="sm" :disabled="savingPayment || !priceEditReady(line)">
                {{ savingPayment ? t('Saving…', 'Guardando…') : t('Save price', 'Guardar precio') }}
              </UiBtn>
              <UiBtn variant="ghost" size="sm" @click="closePriceEditor">{{ t('Cancel', 'Cancelar') }}</UiBtn>
              <button
                v-if="line.list_price_cents != null"
                type="button"
                class="ml-auto flex h-8 items-center rounded-ctlSm px-2 text-[12px] font-medium text-ink-muted hover:bg-brand-tint hover:text-brand-text disabled:opacity-50 touch:h-11"
                :disabled="savingPayment"
                @click="restoreNormalPrice(line)"
              >
                {{ t('Back to the normal price', 'Volver al precio normal') }}
              </button>
            </div>
          </form>
        </li>
      </ul>

      <!-- The receipt was raised while the visit's type cost 0 € (its price
      set afterwards), so the visit itself is not on it at a price.
      useVisitCharging addVisitLine -- without this nothing could charge it. -->
      <div
        v-if="can('billing_access') && visitMissing"
        class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-ctl bg-warning-bg px-2.5 py-2"
        data-cy="appt-add-visit-line"
      >
        <span class="text-[12.5px] text-warning-text">{{ t('The visit is not on this receipt.', 'La visita no está en este recibo.') }}</span>
        <UiBtn variant="secondary" :disabled="savingPayment" @click="addVisitLine">
          {{ savingPayment ? t('Working…', 'Procesando…') : `${t('Add', 'Añadir')} ${appointmentTypeName || t('the visit', 'la visita')} — ${formatEur(visitPriceCents)}` }}
        </UiBtn>
      </div>

      <select
        v-if="can('billing_access') && receiptEditable"
        v-model="addServiceId"
        class="mt-2 h-9 w-full rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11"
        @change="addLineItem"
      >
        <option value="" disabled>{{ t('Add a service or product…', 'Añadir un servicio o producto…') }}</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} ({{ formatEur(s.price_cents) }})</option>
      </select>

      <div class="mt-2 space-y-0.5 border-t border-line-divider pt-2 text-right">
        <p class="text-ink-muted2">{{ t('Total:', 'Total:') }} <span class="font-mono">{{ formatEur(invoice.total_cents) }}</span></p>
        <p class="text-ink-muted2">{{ t('Paid:', 'Pagado:') }} <span class="font-mono">{{ formatEur(paidCents) }}</span></p>
        <p class="font-semibold text-ink-900">{{ t('Balance due:', 'Saldo pendiente:') }} <span class="font-mono">{{ formatEur(balanceDueCents) }}</span></p>
      </div>

      <form
        v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0"
        class="mt-3 space-y-2 border-t border-line-divider pt-3"
        @submit.prevent="recordPayment"
      >
        <div v-for="(row, i) in paymentRows" :key="i" class="flex items-end gap-2">
          <div>
            <label :for="`${fieldId}-amount-${i}`" class="block text-[12px] font-medium text-ink-600">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input :id="`${fieldId}-amount-${i}`" v-model="row.amount" type="number" step="0.01" min="0" class="mt-1 h-9 w-24 rounded-ctl border border-line-control bg-surface px-2 font-mono text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11" />
          </div>
          <div>
            <label :for="`${fieldId}-method-${i}`" class="block text-[12px] font-medium text-ink-600">{{ t('Method', 'Método') }}</label>
            <select :id="`${fieldId}-method-${i}`" v-model="row.method" class="mt-1 h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
              <option v-if="spendableCreditCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} ({{ formatEur(spendableCreditCents) }} {{ t('available', 'disponible') }})</option>
            </select>
          </div>
          <button v-if="paymentRows.length > 1" type="button" class="flex h-9 items-center rounded-ctlSm px-2 text-[12.5px] text-ink-muted hover:bg-danger-bg hover:text-danger-text touch:h-11" @click="removePaymentRow(i)">
            {{ t('Remove', 'Quitar') }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="-ml-2 flex h-9 items-center rounded-ctlSm px-2 text-[12.5px] font-medium text-ink-muted hover:bg-brand-tint hover:text-brand-text touch:h-11" @click="addPaymentRow">
            + {{ t('Split into another method', 'Dividir en otro método') }}
          </button>
          <span v-if="paymentRows.length > 1" class="text-[12px] text-ink-muted">{{ t('Total:', 'Total:') }} <span class="font-mono">{{ formatEur(paymentTotalCents) }}</span></span>
          <UiBtn type="submit" variant="primary" :disabled="savingPayment || paymentTotalCents <= 0">
            {{ savingPayment ? t('Processing…', 'Procesando…') : t('Process', 'Procesar') }}
          </UiBtn>
        </div>
      </form>
      <div
        v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2"
      >
        <span class="text-[12px] text-ink-muted2">{{ t('Or use a bono session:', 'O usar una sesión de bono:') }}</span>
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          class="flex min-h-8 items-center rounded-ctl border border-brand-tintBorder bg-brand-tint px-2.5 py-1 text-[12.5px] font-medium text-brand-text hover:border-brand touch:min-h-11"
          @click="usePackageSession(p)"
        >
          {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})
          <UiPill v-if="p.shared" tone="info" class="ml-1.5">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </UiPill>
        </button>
      </div>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-[12px] text-ink-muted2">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; {{ formatEur(p.amount_cents) }}</li>
      </ul>
      <!-- More than one receipt on this visit -- the extras on one, a bono
      session's charge on another. Named, so neither is invisible. -->
      <p v-if="otherReceipts.length > 0" data-cy="appt-other-receipts" class="mt-2 border-t border-line-divider pt-2 text-[12px] text-ink-muted2">
        {{ t('Also on this visit:', 'También en esta visita:') }}
        <template v-for="(r, i) in otherReceipts" :key="r.id">
          <span v-if="i > 0">, </span>
          <NuxtLink :to="`/billing/${r.id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ r.invoice_number }}</NuxtLink>
          ({{ formatEur(r.total_cents) }}, {{ r.status === 'paid' ? t('paid', 'pagado') : t('unpaid', 'sin pagar') }})
        </template>
      </p>

    </div>
    <!-- An insurer, a medico-legal case or a company paying for some or all of
    the visit. Its share never reaches the patient's receipt above. -->
    <CalendarThirdPartyVisitCharge
      v-if="!loadingInvoice"
      :appointment-id="appointmentId"
      :patient-id="patientId"
      :visit-price-cents="visitPriceCents"
      :invoice="invoice"
      :has-payments="payments.length > 0"
      :can-start="!appointmentIsUpcoming && !packageCoverage"
      @changed="afterThirdPartyChange"
    />
    <p v-if="error" role="alert" class="rounded-ctl bg-danger-bg px-3 py-2 text-danger-text">{{ error }}</p>
  </div>
</template>
