<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { computePay, payPlanIsEmpty } from '~/utils/payPlan'
import { EMPTY_PAY_FACTS, PAY_LINE_LABELS, loadPayMonth, type PayMonth } from '~/composables/usePayMonth'

// A person's file › Retribución: their pay plan and what it came to in a
// month, from the same figures as Reports › Commissions (loadPayMonth).
// For an autónomo that is what they will invoice; for an employee it is the
// variable part the gestoría adds to the nómina. Owners only (pay_plans RLS).
const props = defineProps<{ memberId: string; name: string; timeZone: string; selfEmployed: boolean }>()
const t = useT()
const supabase = useSupabaseClient()

// Last month by default, as Commissions: pay is worked out once a month has closed.
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const month = ref(lastMonth())
const data = ref<PayMonth | null>(null)
const loading = ref(true)
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  const r = await loadPayMonth(supabase, month.value, props.timeZone)
  if (mine !== run) return
  data.value = r
  loading.value = false
}
onMounted(load)
watch(month, load)

const plan = computed(() => data.value?.plans.get(props.memberId) ?? null)
const facts = computed(() => data.value?.facts.get(props.memberId) ?? EMPTY_PAY_FACTS)
const pay = computed(() => (plan.value && !payPlanIsEmpty(plan.value) ? computePay(plan.value, facts.value) : null))
const editing = ref(false)
const monthLabel = computed(() => {
  const s = new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
})
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="file-pay" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-3">
      <input v-model="month" type="month" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 touch:h-11" :aria-label="t('Month', 'Mes')" data-cy="file-pay-month" />
      <span class="text-[13px] text-ink-muted">{{ monthLabel }}</span>
      <span class="flex-1" />
      <UiBtn size="sm" :disabled="loading" data-cy="file-pay-edit" @click="editing = true">{{ plan ? t('Edit pay plan', 'Editar retribución') : t('Set up pay plan', 'Configurar retribución') }}</UiBtn>
    </div>

    <div v-if="loading" aria-busy="true"><UiSkeleton class="h-40 w-full rounded-card" /></div>
    <UiEmptyState v-else-if="!pay" :title="t('No pay plan yet.', 'Todavía no tiene retribución.')" :description="t('A fixed amount, a share of payments, an amount per visit with tiers, or any mix: each month works out from the clinic’s own figures.', 'Un fijo, una parte de los cobros, un importe por visita con tramos, o una mezcla: cada mes se calcula con las cifras de la clínica.')" data-cy="file-pay-empty" />
    <section v-else class="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-4">
      <div class="flex flex-wrap items-baseline gap-x-3">
        <h2 class="text-[14.5px] font-bold text-ink-900">{{ selfEmployed ? t('To invoice', 'A facturar') : t('Earned', 'Generado') }}</h2>
        <strong class="font-mono text-[20px] text-ink-900" data-cy="file-pay-total">{{ formatEur(pay.totalCents) }}</strong>
      </div>
      <ul class="flex flex-col gap-1">
        <li v-for="l in pay.lines" :key="l.key" class="flex justify-between gap-4 text-[13px] text-ink-700" data-cy="file-pay-line">
          <span>{{ t(PAY_LINE_LABELS[l.key]![0], PAY_LINE_LABELS[l.key]![1]) }}<span v-if="l.detail" class="ml-2 text-ink-faint">{{ l.detail }}</span></span>
          <span class="font-mono">{{ formatEur(l.cents) }}</span>
        </li>
      </ul>
      <dl class="grid grid-cols-2 gap-3 border-t border-line-row pt-3 sm:grid-cols-4">
        <div><dt class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Visits', 'Visitas') }}</dt><dd class="font-mono text-[14px] text-ink-900" data-cy="file-pay-visits">{{ facts.visits }}</dd></div>
        <div><dt class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('New', 'Nuevos') }}</dt><dd class="font-mono text-[14px] text-ink-900">{{ facts.newPatients }}</dd></div>
        <div><dt class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Payments', 'Cobros') }}</dt><dd class="font-mono text-[14px] text-ink-900">{{ formatEur(facts.paymentsCents) }}</dd></div>
        <div><dt class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Sales', 'Ventas') }}</dt><dd class="font-mono text-[14px] text-ink-900">{{ formatEur(facts.salesCents) }}</dd></div>
      </dl>
      <p v-if="!selfEmployed" class="text-[12px] text-ink-muted">{{ t('What the plan comes to, before tax and Social Security: the gestoría works out the payslip.', 'Lo que sale del plan, antes de impuestos y Seguridad Social: la nómina la calcula la gestoría.') }}</p>
    </section>
    <NuxtLink to="/reports/commissions" class="self-start text-[12.5px] font-semibold text-brand-text hover:underline">{{ t('Everyone’s commissions →', 'Comisiones de todo el equipo →') }}</NuxtLink>

    <ReportsPayPlanEditor v-if="editing" :team-member-id="memberId" :name="name" :plan="plan" @close="editing = false" @saved="editing = false; load()" />
  </div>
</template>
