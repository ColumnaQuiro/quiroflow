<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { bonoPerSessionCents } from '../../utils/visitCharging'
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
  creditLedgerCents,
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
  addLineItem,
  removeLineItem,
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

onMounted(init)

// An appointment type with no price of its own (the visit is billed from the
// services added to it) would otherwise offer "Charge €0.00".
// The rate a bono button quotes, rounded the way usePackageSession rounds
// what it actually bills, so the button and the charge cannot disagree.
function perSessionLabel(p: { price_cents: number; sessions_total: number }): string {
  if (!p.sessions_total) return '—'
  return `${formatEur(bonoPerSessionCents(p))}`
}

const chargeLabel = computed(() =>
  visitPriceCents.value > 0
    ? `${t('Charge', 'Cobrar')} ${formatEur(visitPriceCents.value)}`
    : t('Charge this visit', 'Cobrar esta visita'),
)
</script>

<template>
  <div class="space-y-4 text-sm">
    <div class="rounded-card border border-line bg-surface-subtle p-3">
      <div v-if="summaryLoading" class="text-ink-faint">{{ t('Loading patient summary…', 'Cargando resumen del paciente…') }}</div>
      <div v-else class="space-y-1.5">
        <p class="flex items-center gap-1.5">
          <span class="text-ink-muted2">{{ t('Balance:', 'Saldo:') }}</span>
          <UiBalancePill :available-cents="availableCents" :outstanding-cents="outstandingCents" />
          <span v-if="balanceCents === 0" class="font-medium text-ink-700">€0.00</span>
        </p>
        <p v-if="activeMembership">
          <span class="text-ink-muted2">{{ t('Membership:', 'Membresía:') }}</span>
          <span class="ml-1 font-medium text-ink-900">{{ activeMembership.membership_name }}</span>
          <span class="ml-1 rounded-ctlSm bg-success-bg px-1.5 py-0.5 text-xs font-medium text-success-text">{{ t('active', 'activa') }}</span>
        </p>
        <p v-else class="text-ink-faint">{{ t('No active membership', 'Sin membresía activa') }}</p>
        <div v-if="activePackages.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-ink-muted2">{{ t('Packages:', 'Bonos:') }}</span>
          <span
            v-for="p in activePackages"
            :key="p.id"
            class="inline-flex items-center gap-1.5 rounded-ctlSm bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand-text"
          >
            {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}
            <span
              v-if="p.shared"
              class="rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text"
              :title="p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido')"
            >
              {{ t('Shared', 'Compartido') }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="text-ink-faint">{{ t('Loading receipt…', 'Cargando recibo…') }}</div>
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
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          :disabled="savingPayment"
          class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          @click="usePackageSession(p)"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : `${t('Use', 'Usar')} ${p.package_name} — ${perSessionLabel(p)}` }}
          <span class="font-normal opacity-80">({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})</span>
          <span v-if="p.shared" class="ml-1 rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </span>
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2" :class="activePackages.length > 0 ? 'border-t border-line-divider pt-2' : ''">
        <button
          type="button"
          :disabled="savingPayment"
          :class="
            activePackages.length > 0
              ? 'rounded-ctl border border-line-control px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-line-controlHover hover:text-ink-900 disabled:opacity-50'
              : 'rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50'
          "
          @click="chargeVisit"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : activePackages.length > 0 ? `${chargeLabel} ${t('instead', 'en su lugar')}` : chargeLabel }}
        </button>
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
          <span
            class="rounded-ctlSm px-1.5 py-0.5 text-xs font-medium"
            :class="invoice.status === 'paid' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'"
          >
            {{ invoice.status }}
          </span>
          <span v-if="sendResult" class="text-xs text-ink-faint">{{ sendResult }}</span>
          <button
            v-else-if="can('billing_access')"
            type="button"
            class="text-xs font-medium text-brand-text hover:text-brand-hover disabled:opacity-50"
            :disabled="sendingInvoice"
            @click="sendInvoiceEmail"
          >
            {{ sendingInvoice ? t('Sending…', 'Enviando…') : t('Send receipt', 'Enviar recibo') }}
          </button>
        </div>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="flex items-center justify-between text-ink-700">
          <span>{{ line.description }} &times;{{ line.quantity }}</span>
          <span class="flex items-center gap-2">
            {{ formatEur((line.price_cents * line.quantity)) }}
            <button
              v-if="can('billing_access') && invoice.status !== 'paid'"
              type="button"
              class="text-ink-faint hover:text-danger-text"
              @click="removeLineItem(line)"
            >
              ✕
            </button>
          </span>
        </li>
      </ul>

      <select
        v-if="can('billing_access') && invoice.status !== 'paid'"
        v-model="addServiceId"
        class="mt-2 w-full rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none"
        @change="addLineItem"
      >
        <option value="" disabled>{{ t('-- Add Service/Product --', '-- Añadir servicio/producto --') }}</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} ({{ formatEur(s.price_cents) }})</option>
      </select>

      <div class="mt-2 space-y-0.5 border-t border-line-divider pt-2 text-right">
        <p class="text-ink-muted2">{{ t('Total:', 'Total:') }} {{ formatEur(invoice.total_cents) }}</p>
        <p class="text-ink-muted2">{{ t('Paid:', 'Pagado:') }} {{ formatEur(paidCents) }}</p>
        <p class="font-semibold text-ink-900">{{ t('Balance due:', 'Saldo pendiente:') }} {{ formatEur(balanceDueCents) }}</p>
      </div>

      <form
        v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0"
        class="mt-3 space-y-2 border-t border-line-divider pt-3"
        @submit.prevent="recordPayment"
      >
        <div v-for="(row, i) in paymentRows" :key="i" class="flex items-end gap-2">
          <div>
            <label class="block text-xs font-medium text-ink-700">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="row.amount" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div>
            <label class="block text-xs font-medium text-ink-700">{{ t('Method', 'Método') }}</label>
            <select v-model="row.method" class="mt-1 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
              <option v-if="creditLedgerCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} ({{ formatEur(creditLedgerCents) }} {{ t('available', 'disponible') }})</option>
            </select>
          </div>
          <button v-if="paymentRows.length > 1" type="button" class="mb-2 text-xs text-ink-faint hover:text-danger-text" @click="removePaymentRow(i)">
            {{ t('Remove', 'Quitar') }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="text-xs font-medium text-ink-muted hover:text-brand-text" @click="addPaymentRow">
            + {{ t('Split into another method', 'Dividir en otro método') }}
          </button>
          <span v-if="paymentRows.length > 1" class="text-xs text-ink-faint">{{ t('Total:', 'Total:') }} {{ formatEur(paymentTotalCents) }}</span>
          <button type="submit" :disabled="savingPayment || paymentTotalCents <= 0" class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">
            {{ savingPayment ? t('Processing…', 'Procesando…') : t('Process', 'Procesar') }}
          </button>
        </div>
      </form>
      <div
        v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2"
      >
        <span class="text-xs text-ink-muted2">{{ t('Or use a package session:', 'O usar una sesión de bono:') }}</span>
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-2 py-1 text-xs font-medium text-brand-text hover:brightness-95"
          @click="usePackageSession(p)"
        >
          {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})
          <span v-if="p.shared" class="ml-1 rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </span>
        </button>
      </div>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-xs text-ink-muted2">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; {{ formatEur(p.amount_cents) }}</li>
      </ul>
      <!-- More than one receipt on this visit -- the extras on one, a bono
      session's charge on another. Named, so neither is invisible. -->
      <p v-if="otherReceipts.length > 0" data-cy="appt-other-receipts" class="mt-2 border-t border-line-divider pt-2 text-xs text-ink-muted2">
        {{ t('Also on this visit:', 'También en esta visita:') }}
        <template v-for="(r, i) in otherReceipts" :key="r.id">
          <span v-if="i > 0">, </span>
          <NuxtLink :to="`/billing/${r.id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ r.invoice_number }}</NuxtLink>
          ({{ formatEur(r.total_cents) }}, {{ r.status === 'paid' ? t('paid', 'pagado') : t('unpaid', 'sin pagar') }})
        </template>
      </p>

    </div>
    <p v-if="error" class="text-danger-text">{{ error }}</p>
  </div>
</template>
