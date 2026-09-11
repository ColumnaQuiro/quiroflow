<script setup lang="ts">
// Bonos, balance and invoices -- one question, one screen.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')

const { loading: moneyLoading, balanceCents, creditLedgerCents, activePackages, activeMembership } = usePatientFinancialSummary(
  () => patientId.value,
)
const { invoices, loading: invoicesLoading, busyId, download } = usePatientInvoices(() => patientId.value)

const amountDueCents = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))

const showAll = ref(false)
const PREVIEW = 8
const visibleInvoices = computed(() => (showAll.value ? invoices.value : invoices.value.slice(0, PREVIEW)))

function eur(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <PatientScreen :title="t('Billing', 'Pagos')">
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Credit', 'Saldo') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-16 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[22px] font-[640] tracking-tightTitle text-ink-900">{{ eur(creditLedgerCents) }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-faint">{{ t('Outstanding', 'Pendiente') }}</p>
        <p v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-6 w-16 rounded-ctlSm" /></p>
        <p v-else class="mt-1 text-[22px] font-[640] tracking-tightTitle" :class="amountDueCents > 0 ? 'text-danger-text' : 'text-ink-900'">
          {{ eur(amountDueCents) }}
        </p>
      </div>
    </div>

    <div class="mt-3">
      <PatientCard :title="t('Your packages', 'Tus bonos')">
        <div v-if="moneyLoading"><UiSkeleton class="h-10 w-full rounded-ctl" /></div>
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

    <div class="mt-3">
      <PatientCard :title="t('Invoices', 'Facturas')" flush>
        <div v-if="invoicesLoading" class="space-y-3 p-4">
          <UiSkeleton class="h-8 w-full rounded-ctl" />
        </div>
        <ul v-else-if="invoices.length > 0" class="divide-y divide-line-divider">
          <li v-for="inv in visibleInvoices" :key="inv.id" class="flex items-center gap-2.5 px-4 py-3">
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
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctlSm border border-line-control text-ink-600 disabled:opacity-50"
              :disabled="busyId === inv.id"
              :aria-label="t('Download PDF', 'Descargar PDF')"
              @click="download(inv)"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 2.5v7M5.4 7.2L8 9.8l2.6-2.6M3 12.5h10" />
              </svg>
            </button>
          </li>
        </ul>
        <PatientEmpty v-else :text="t('No invoices yet.', 'Todavía no hay facturas.')" />
        <div v-if="!showAll && invoices.length > PREVIEW" class="border-t border-line-divider px-4 py-2.5">
          <button type="button" class="text-[12.5px] font-medium text-ink-muted" @click="showAll = true">
            {{ t(`Show all ${invoices.length}`, `Ver las ${invoices.length}`) }}
          </button>
        </div>
      </PatientCard>
    </div>
  </PatientScreen>
</template>
