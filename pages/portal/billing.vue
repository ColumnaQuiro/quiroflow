<script setup lang="ts">
// Money and bonos, together, because a patient's question is one question:
// what do I have left and what do I owe?
definePageMeta({ layout: 'portal' })

const t = useT()
const { patient } = usePortalPatient()
const patientId = computed(() => patient.value?.id ?? '')

const { loading: moneyLoading, balanceCents, creditLedgerCents, activePackages, activeMembership } = usePatientFinancialSummary(
  () => patientId.value,
)
const { invoices, loading: invoicesLoading, busyId, download } = usePatientInvoices(() => patientId.value)
// Facturas are the documents; the invoices below are the charges that make up
// the balance. Two lists on purpose -- a patient asking "what did I pay?" and
// a patient asking "what am I being charged for?" are asking different things.
const { facturas, loading: facturasLoading, busyId: facturaBusyId, download: downloadFactura } = usePatientFacturas(() => patientId.value)

const amountDueCents = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))

const showAll = ref(false)
const PREVIEW = 10
const visibleInvoices = computed(() => (showAll.value ? invoices.value : invoices.value.slice(0, PREVIEW)))

function eur(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div>
    <PatientPageHead
      :title="t('Billing', 'Facturación')"
      :lead="t('Your packages, your balance and every invoice.', 'Tus bonos, tu saldo y todas tus facturas.')"
    />

    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Credit', 'Saldo a favor') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-7 w-20 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[24px] font-[640] tracking-tightTitle text-ink-900">{{ eur(creditLedgerCents) }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Outstanding', 'Pendiente') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-7 w-20 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[24px] font-[640] tracking-tightTitle" :class="amountDueCents > 0 ? 'text-danger-text' : 'text-ink-900'">
          {{ eur(amountDueCents) }}
        </p>
      </div>
    </div>

    <div class="mt-4">
      <PatientCard :title="t('Your packages', 'Tus bonos')">
        <div v-if="moneyLoading" class="space-y-4">
          <UiSkeleton class="h-10 w-full rounded-ctl" />
        </div>
        <div v-else-if="activePackages.length > 0" class="space-y-4">
          <PatientBonoProgress
            v-for="pkg in activePackages"
            :key="pkg.id"
            :name="pkg.package_name"
            :sessions-total="pkg.sessions_total"
            :sessions-used="pkg.sessions_used"
            :shared-by="pkg.shared ? pkg.ownerName : undefined"
          />
          <p v-if="activeMembership" class="border-t border-line-divider pt-3 text-[12.5px] text-ink-muted">
            {{ t(`${activeMembership.membership_name} membership active`, `Membresía ${activeMembership.membership_name} activa`) }}
          </p>
        </div>
        <p v-else class="text-[13px] text-ink-faint">{{ t('You have no active package.', 'No tienes ningún bono activo.') }}</p>
      </PatientCard>
    </div>

    <div class="mt-4">
      <PatientCard :title="t('Your facturas', 'Tus facturas')" flush>
        <div v-if="facturasLoading" class="space-y-3 p-4">
          <UiSkeleton class="h-8 w-full rounded-ctl" />
        </div>
        <ul v-else-if="facturas.length > 0" class="divide-y divide-line-divider">
          <li v-for="f in facturas" :key="f.id" class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium text-ink-900">{{ eur(f.amount_cents) }}</p>
              <p class="truncate text-[12px] text-ink-muted">{{ f.description }}</p>
              <p class="text-[12px] text-ink-faint">{{ new Date(f.issued_at).toLocaleDateString() }} &middot; {{ f.number }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-ctlSm border border-line-control px-2 py-1 text-[12px] font-medium text-ink-600 hover:border-line-controlHover hover:text-ink-900 disabled:opacity-50"
              :disabled="facturaBusyId === f.id"
              @click="downloadFactura(f)"
            >
              {{ facturaBusyId === f.id ? t('…', '…') : t('PDF', 'PDF') }}
            </button>
          </li>
        </ul>
        <PatientEmpty v-else :text="t('No facturas yet.', 'Todavía no hay facturas.')" />
      </PatientCard>
    </div>

    <div class="mt-4">
      <PatientCard :title="t('Charges', 'Cargos')" flush>
        <div v-if="invoicesLoading" class="space-y-3 p-4">
          <UiSkeleton class="h-8 w-full rounded-ctl" />
          <UiSkeleton class="h-8 w-full rounded-ctl" />
        </div>
        <ul v-else-if="invoices.length > 0" class="divide-y divide-line-divider">
          <li v-for="inv in visibleInvoices" :key="inv.id" class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium text-ink-900">{{ eur(inv.total_cents) }}</p>
              <p class="text-[12px] text-ink-faint">
                {{ new Date(inv.created_at).toLocaleDateString() }}
                <template v-if="inv.invoice_number"> &middot; {{ inv.invoice_number }}</template>
              </p>
            </div>
            <span
              class="shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-medium"
              :class="PATIENT_INVOICE_STATUS[inv.status]?.chip ?? 'bg-chip-bg text-chip-text'"
            >
              {{ t(PATIENT_INVOICE_STATUS[inv.status]?.label[0] ?? inv.status, PATIENT_INVOICE_STATUS[inv.status]?.label[1] ?? inv.status) }}
            </span>
            <button
              type="button"
              class="shrink-0 rounded-ctlSm border border-line-control px-2 py-1 text-[12px] font-medium text-ink-600 hover:border-line-controlHover hover:text-ink-900 disabled:opacity-50"
              :disabled="busyId === inv.id"
              @click="download(inv)"
            >
              {{ busyId === inv.id ? t('…', '…') : t('PDF', 'PDF') }}
            </button>
          </li>
        </ul>
        <PatientEmpty v-else :text="t('No charges yet.', 'Todavía no hay cargos.')" />
        <div v-if="!showAll && invoices.length > PREVIEW" class="border-t border-line-divider px-4 py-2.5">
          <button type="button" class="text-[12.5px] font-medium text-ink-muted hover:text-ink-700" @click="showAll = true">
            {{ t(`Show all ${invoices.length}`, `Ver las ${invoices.length}`) }}
          </button>
        </div>
      </PatientCard>
    </div>
  </div>
</template>
