<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { computePay, payPlanIsEmpty, type PayFacts, type PayPlan } from '~/utils/payPlan'
import { EMPTY_PAY_FACTS, PAY_LINE_LABELS, loadPayMonth, type PayMonthMember } from '~/composables/usePayMonth'

// Commissions: what each team member earned in a month, from their pay plan
// (pay_plans, set here) and the month's figures. Owners only -- the route
// rule and pay_plans' RLS both say so. The figures come from loadPayMonth
// (composables/usePayMonth.ts), shared with a person's file in Personal.
const t = useT()
const supabase = useSupabaseClient()
const tz = DEFAULT_CLINIC_TIMEZONE

// Last month by default: pay is worked out once a month has closed.
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const month = ref(lastMonth())

const members = ref<PayMonthMember[]>([])
const plans = ref<Map<string, PayPlan>>(new Map())
const facts = ref<Map<string, PayFacts>>(new Map())
const unattributedCents = ref(0)
const loading = ref(true)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  const r = await loadPayMonth(supabase, month.value, tz)
  if (mine !== run) return
  members.value = r.members
  plans.value = r.plans
  facts.value = r.facts
  unattributedCents.value = r.unattributedCents
  loading.value = false
}
onMounted(load)
watch(month, load)

// Everyone with a plan, and every practitioner without one (to set it up).
const rows = computed(() =>
  members.value
    .filter((mm) => plans.value.has(mm.id) || mm.is_practitioner)
    .map((mm) => {
      const plan = plans.value.get(mm.id) ?? null
      const f = facts.value.get(mm.id) ?? EMPTY_PAY_FACTS
      const pay = plan && !payPlanIsEmpty(plan) ? computePay(plan, f) : null
      return { member: mm, plan, facts: f, pay }
    }),
)
const totalCents = computed(() => rows.value.reduce((s, r) => s + (r.pay?.totalCents ?? 0), 0))
const open = ref<string | null>(null)
const editing = ref<{ id: string; name: string; plan: PayPlan | null } | null>(null)

const LINE = PAY_LINE_LABELS
const monthLabel = computed(() => {
  const s = new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
})

function csvEscape(v: string) {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function exportCsv() {
  const euros = (c: number) => (c / 100).toFixed(2)
  const header = [t('Person', 'Persona'), t('Visits', 'Visitas'), t('New patients', 'Pacientes nuevos'), t('Payments attributed', 'Cobros atribuidos'), t('Sales', 'Ventas'), ...Object.values(LINE).map(([en, es]) => t(en, es)), t('Total', 'Total')]
  const lines = rows.value.map((r) => {
    const part = (k: string) => euros(r.pay?.lines.find((l) => l.key === k)?.cents ?? 0)
    return [r.member.full_name, String(r.facts.visits), String(r.facts.newPatients), euros(r.facts.paymentsCents), euros(r.facts.salesCents), ...Object.keys(LINE).map(part), euros(r.pay?.totalCents ?? 0)]
  })
  const csv = [header, ...lines].map((cols) => cols.map(csvEscape).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${t('commissions', 'comisiones')}-${month.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
const th = 'px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2'
const td = 'px-3 py-2.5 font-mono text-[13px] text-ink-800'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Commissions', 'Comisiones')" :meta="t('What each person earned, from their pay plan', 'Lo que ha generado cada persona, según su retribución')">
      <div class="flex items-center gap-3">
        <ReportsBackLink />
        <UiBtn :disabled="loading" data-cy="commissions-csv" @click="exportCsv">{{ t('Export CSV', 'Exportar CSV') }}</UiBtn>
      </div>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="commissions" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-3">
        <input v-model="month" type="month" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 touch:h-11" :aria-label="t('Month', 'Mes')" data-cy="commissions-month" />
        <span class="text-[13px] text-ink-muted">{{ monthLabel }}</span>
        <span class="ml-auto text-[13px] text-ink-700">{{ t('Total', 'Total') }}: <strong class="font-mono text-[15px] text-ink-900" data-cy="commissions-total">{{ formatEur(totalCents) }}</strong></span>
      </div>

      <div class="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <div v-if="loading" class="space-y-2 p-4"><UiSkeleton v-for="i in 4" :key="i" class="h-10 w-full rounded-ctl" /></div>
        <table v-else class="w-full min-w-[720px]">
          <thead class="border-b border-line bg-surface-subtle">
            <tr>
              <th :class="th">{{ t('Person', 'Persona') }}</th>
              <th :class="th">{{ t('Visits', 'Visitas') }}</th>
              <th :class="th">{{ t('New', 'Nuevos') }}</th>
              <th :class="th">{{ t('Payments', 'Cobros') }}</th>
              <th :class="th">{{ t('Sales', 'Ventas') }}</th>
              <th :class="th">{{ t('Earned', 'Generado') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-for="r in rows" :key="r.member.id">
              <tr class="cursor-pointer hover:bg-surface-subtle" data-cy="commissions-row" @click="open = open === r.member.id ? null : r.member.id">
                <td class="px-3 py-2.5 text-[13.5px] font-medium text-ink-900">{{ r.member.full_name }}</td>
                <td :class="td">{{ r.facts.visits }}</td>
                <td :class="td">{{ r.facts.newPatients }}</td>
                <td :class="td">{{ formatEur(r.facts.paymentsCents) }}</td>
                <td :class="td">{{ formatEur(r.facts.salesCents) }}</td>
                <td class="px-3 py-2.5 font-mono text-[14px] font-semibold text-ink-900" data-cy="commissions-earned">
                  <template v-if="r.pay">{{ formatEur(r.pay.totalCents) }}</template>
                  <span v-else class="font-sans text-[12.5px] font-normal text-ink-faint">{{ t('No pay plan', 'Sin retribución') }}</span>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <button type="button" class="inline-flex h-8 items-center whitespace-nowrap rounded-ctl px-2 text-[12.5px] font-medium text-brand-text hover:bg-brand-tint touch:h-11" data-cy="commissions-edit" @click.stop="editing = { id: r.member.id, name: r.member.full_name, plan: r.plan }">{{ r.plan ? t('Edit plan', 'Editar') : t('Set up', 'Configurar') }}</button>
                </td>
              </tr>
              <tr v-if="open === r.member.id && r.pay" class="bg-surface-subtle/60" data-cy="commissions-detail">
                <td colspan="7" class="px-5 py-3">
                  <ul class="flex flex-col gap-1">
                    <li v-for="l in r.pay.lines" :key="l.key" class="flex justify-between gap-4 text-[13px] text-ink-700">
                      <span>{{ t(LINE[l.key]![0], LINE[l.key]![1]) }}<span v-if="l.detail" class="ml-2 text-ink-faint">{{ l.detail }}</span></span>
                      <span class="font-mono">{{ formatEur(l.cents) }}</span>
                    </li>
                  </ul>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && unattributedCents" class="mt-3 text-[12.5px] text-ink-muted" data-cy="commissions-unattributed">
        {{ t(`${formatEur(unattributedCents)} of payments could not be attributed to anyone (no visit and no practitioner on the patient), so no % counts them.`, `${formatEur(unattributedCents)} de cobros no se pueden atribuir a nadie (sin visita ni profesional en el paciente), así que ningún % los cuenta.`) }}
      </p>
    </div>

    <ReportsPayPlanEditor v-if="editing" :team-member-id="editing.id" :name="editing.name" :plan="editing.plan" @close="editing = null" @saved="editing = null; load()" />
  </div>
</template>
