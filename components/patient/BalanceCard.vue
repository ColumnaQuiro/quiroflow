<script setup lang="ts">
// Balance, bonos and care plan -- lifted out of mobile's PatientHome so the
// web portal shows them too. usePatientFinancialSummary already lives in
// the root app and works in both.
const props = defineProps<{ patientId: string }>()

const t = useT()
// Credit held and amount owed are shown as two numbers, not netted into
// one. UiBalancePill's own comment explains why: a patient with 200 EUR of
// credit and a 240 EUR instalment outstanding netted to "40 Due", hiding
// both real figures behind their difference. A patient reading their own
// record deserves the same two numbers reception gets.
const { loading, balanceCents, creditLedgerCents, activeMembership, activePackages } = usePatientFinancialSummary(() => props.patientId)

// balanceCents is negative when the patient owes money.
const amountDueCents = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))
</script>

<template>
  <section>
    <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Balance & packages', 'Saldo y bonos') }}</h2>
    <div class="mt-2 rounded-card border border-line bg-surface p-4">
      <div v-if="loading" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <template v-else>
        <div v-if="creditLedgerCents > 0 || amountDueCents > 0" class="flex flex-wrap items-center gap-2">
          <UiBalancePill v-if="creditLedgerCents > 0" :credit-cents="creditLedgerCents" />
          <span v-if="amountDueCents > 0" class="rounded-pill bg-danger-bg px-2 py-0.5 text-[12.5px] font-medium text-danger-text">
            {{ t(`€${(amountDueCents / 100).toFixed(2)} due`, `€${(amountDueCents / 100).toFixed(2)} pendiente`) }}
          </span>
        </div>
        <p v-else class="text-[13px] text-ink-muted">{{ t('Balance is settled.', 'No tienes saldo pendiente.') }}</p>

        <div v-if="activePackages.length > 0" class="mt-2 space-y-1 border-t border-line-divider pt-2">
          <p v-for="pkg in activePackages" :key="pkg.id" class="text-[12.5px] text-ink-muted">
            {{ pkg.package_name }} —
            {{ t(
              `${pkg.sessions_total - pkg.sessions_used} of ${pkg.sessions_total} sessions left`,
              `quedan ${pkg.sessions_total - pkg.sessions_used} de ${pkg.sessions_total} sesiones`,
            ) }}
          </p>
        </div>
        <p v-if="activeMembership" class="mt-2 border-t border-line-divider pt-2 text-[12.5px] text-ink-muted">
          {{ t(`${activeMembership.membership_name} membership active`, `Membresía ${activeMembership.membership_name} activa`) }}
        </p>
      </template>
    </div>
  </section>
</template>
