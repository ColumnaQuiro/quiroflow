<script setup lang="ts">
// Comisiones, on the phone: the web's pages/reports/commissions.vue, with the
// same reads and the same calculation (utils/payPlan's payFactsByMember and
// computePay, receipts per utils/paymentReceipts, attribution per
// utils/incomeAttribution), so what a person earned here is what the web
// says. Owners only -- ReportScreen applies the web's route rule and
// pay_plans' RLS says the same. Reshaped for a phone: the month is a chip,
// the table is a list of people with their earnings, and tapping one opens
// the breakdown by line. Read-only: pay plans are edited on the web
// (ReportsPayPlanEditor needs the account store, which the app does not
// have), and the CSV export is left out (no file download on the app).
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { formatEur } from '../../../utils/billing'
import { DEFAULT_CLINIC_TIMEZONE, startOfLocalDate } from '../../../utils/clinicClock'
import { practitionerForPayment } from '../../../utils/incomeAttribution'
import { isReceipt } from '../../../utils/paymentReceipts'
import { computePay, payFactsByMember, payPlanIsEmpty, type PayFacts, type PayPlan, type PayTierMode } from '../../../utils/payPlan'

definePageMeta({ layout: 'practitioner' })

// The figures are the reports' own: money is receipts on non-void invoices
// (utils/paymentReceipts), attributed to a practitioner as Income attributes
// it (visit's practitioner, else the patient's own); a visit is an attended
// appointment and belongs to its practitioner; a new patient is one whose
// first attended visit ever is in the month; a sale is a bono or membership,
// to whoever recorded it. The month is the clinic's calendar month -- in the
// same zone the web uses (DEFAULT_CLINIC_TIMEZONE), so the two agree.
const PATH = '/reports/commissions'
const t = useT()
const supabase = useSupabaseClient()
const { canOpen, context } = useReportAccess()
const tz = DEFAULT_CLINIC_TIMEZONE

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
// Last month by default: pay is worked out once a month has closed.
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return monthKey(d)
}
const month = ref(lastMonth())
const locale = computed(() => t('en-GB', 'es-ES'))
function labelOf(key: string) {
  const s = new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale.value, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
// The web's month field, as a picker: this month and the 23 before it.
const monthOptions = computed(() => {
  const d = new Date()
  d.setDate(1)
  return Array.from({ length: 24 }, (_unused, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    return { id: monthKey(m), name: labelOf(monthKey(m)) }
  })
})
const bounds = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const next = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`
  return { from: startOfLocalDate(`${month.value}-01`, tz), to: startOfLocalDate(`${next}-01`, tz) }
})

interface Member { id: string; full_name: string; is_practitioner: boolean }
type PlanRow = PayPlan & { team_member_id: string }
const members = ref<Member[]>([])
const plans = ref<Map<string, PayPlan>>(new Map())
const facts = ref<Map<string, PayFacts>>(new Map())
const unattributedCents = ref(0)
const loading = ref(true)
const failed = ref(false)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  try {
    const { from, to } = bounds.value
    const f0 = from.toISOString()
    const t0 = to.toISOString()
    type Pay = { amount_cents: number; method: string; invoices: { status: string; appointments: { practitioner_id: string | null } | null } | null; patients: { default_practitioner_id: string | null } | null }
    const [m, p, pays, visits, bonos, memberships] = await Promise.all([
      supabase.from('team_members').select('id, full_name, is_practitioner').is('deleted_at', null).order('full_name'),
      supabase.from('pay_plans').select('team_member_id, base_cents, payments_pct, visit_cents, tier_mode, tiers, new_patient_cents, sales_pct'),
      fetchAllRows<Pay>((f, tt) => supabase.from('payments').select('amount_cents, method, invoices!payments_invoice_id_fkey(status, appointments!invoices_appointment_id_fkey(practitioner_id)), patients!payments_patient_id_fkey(default_practitioner_id)').gte('paid_at', f0).lt('paid_at', t0).range(f, tt) as never),
      fetchAllRows<{ practitioner_id: string | null; patient_id: string | null }>((f, tt) => supabase.from('appointments').select('practitioner_id, patient_id').eq('status', 'completed').is('deleted_at', null).gte('starts_at', f0).lt('starts_at', t0).range(f, tt) as never),
      fetchAllRows<{ price_cents: number; created_by: string | null }>((f, tt) => supabase.from('package_purchases').select('price_cents, created_by').gte('purchased_at', f0).lt('purchased_at', t0).range(f, tt) as never),
      fetchAllRows<{ price_cents: number; created_by: string | null }>((f, tt) => supabase.from('patient_memberships').select('price_cents, created_by').gte('started_at', f0).lt('started_at', t0).range(f, tt) as never),
    ])
    if (m.error) throw m.error
    if (p.error) throw p.error
    // Who had been in before the month: their visit this month is not a first.
    const patientIds = [...new Set(visits.map((v) => v.patient_id).filter((x): x is string => !!x))]
    const seenBefore = new Set<string>()
    for (let i = 0; i < patientIds.length; i += 200) {
      const { data, error } = await supabase.from('appointments').select('patient_id').eq('status', 'completed').is('deleted_at', null).lt('starts_at', from.toISOString()).in('patient_id', patientIds.slice(i, i + 200))
      if (error) throw error
      for (const r of (data as { patient_id: string }[] | null) ?? []) seenBefore.add(r.patient_id)
    }
    if (mine !== run) return
    const receipts = pays.filter((x) => x.invoices?.status !== 'void' && isReceipt(x.method))
    const attributed = receipts.map((x) => ({
      cents: x.amount_cents,
      practitionerId: practitionerForPayment({ appointment: x.invoices?.appointments ? { practitioner_id: x.invoices.appointments.practitioner_id, clinic_id: null } : null, patient: x.patients ? { default_practitioner_id: x.patients.default_practitioner_id, clinic_id: null } : null }),
    }))
    unattributedCents.value = attributed.filter((x) => !x.practitionerId).reduce((s, x) => s + x.cents, 0)
    members.value = (m.data as Member[] | null) ?? []
    plans.value = new Map(((p.data as unknown as PlanRow[] | null) ?? []).map((r) => [r.team_member_id, { ...r, payments_pct: Number(r.payments_pct), sales_pct: Number(r.sales_pct), tier_mode: r.tier_mode as PayTierMode, tiers: Array.isArray(r.tiers) ? r.tiers : [] }]))
    facts.value = payFactsByMember({
      payments: attributed,
      visits: visits.map((v) => ({ practitionerId: v.practitioner_id, patientId: v.patient_id })),
      seenBefore,
      sales: [...bonos, ...memberships].map((s) => ({ cents: s.price_cents, soldBy: s.created_by })),
    })
  } catch {
    if (mine !== run) return
    failed.value = true
  }
  loading.value = false
}
// Only once the role is known to include it (owners): a refused read would
// come back empty and read as "nobody earned anything".
watch(() => !!context.value && canOpen(PATH), (ok) => { if (ok) load() }, { immediate: true })
watch(month, () => { if (context.value && canOpen(PATH)) load() })

const EMPTY_FACTS: PayFacts = { paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 0 }
// Everyone with a plan, and every practitioner without one.
const rows = computed(() =>
  members.value
    .filter((mm) => plans.value.has(mm.id) || mm.is_practitioner)
    .map((mm) => {
      const plan = plans.value.get(mm.id) ?? null
      const f = facts.value.get(mm.id) ?? EMPTY_FACTS
      const pay = plan && !payPlanIsEmpty(plan) ? computePay(plan, f) : null
      return { member: mm, plan, facts: f, pay }
    }),
)
const totalCents = computed(() => rows.value.reduce((s, r) => s + (r.pay?.totalCents ?? 0), 0))
const open = ref<string | null>(null)

const LINE: Record<string, [string, string]> = {
  base: ['Fixed', 'Fijo'],
  payments: ['Share of payments', 'Parte de los cobros'],
  visits: ['Visits', 'Visitas'],
  new_patients: ['New patients', 'Pacientes nuevos'],
  sales: ['Bonos and memberships sold', 'Bonos y membresías vendidos'],
}
function figures(f: PayFacts) {
  return [
    t(`${f.visits} visits`, `${f.visits} visitas`),
    t(`${f.newPatients} new`, `${f.newPatients} nuevos`),
    `${t('Payments', 'Cobros')} ${formatEur(f.paymentsCents)}`,
    `${t('Sales', 'Ventas')} ${formatEur(f.salesCents)}`,
  ].join(' · ')
}
</script>

<template>
  <ReportScreen :title="t('Commissions', 'Comisiones')" path="/reports/commissions" :description="t('What each person earned, from their pay plan', 'Lo que ha generado cada persona, según su retribución')">
    <template #filters>
      <ReportSelect v-model="month" :options="monthOptions" :label="t('Month', 'Mes')" data-cy="report-commissions-month" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <ReportsStat :label="t('Total', 'Total')" :loading="loading">
      <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-commissions-total">{{ formatEur(totalCents) }}</p>
      <p class="text-[12px] text-ink-muted">{{ labelOf(month) }}</p>
    </ReportsStat>

    <ReportsModule :title="t('Earned', 'Generado')" :loading="loading" skeleton="list" :rows="4">
      <p v-if="rows.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No practitioners or pay plans yet.', 'Todavía no hay profesionales ni retribuciones.') }}</p>
      <ul v-else class="mt-1" data-cy="report-commissions-list">
        <li v-for="r in rows" :key="r.member.id" class="border-b border-line-divider last:border-b-0" data-cy="report-commissions-row">
          <button
            type="button"
            class="flex min-h-[52px] w-full items-center gap-3 py-2.5 text-left active:bg-surface-subtle disabled:active:bg-transparent"
            :disabled="!r.pay"
            :aria-expanded="r.pay ? open === r.member.id : undefined"
            @click="open = open === r.member.id ? null : r.member.id"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-[14.5px] font-medium text-ink-900">{{ r.member.full_name }}</span>
              <span class="text-[12.5px] leading-snug text-ink-muted">{{ figures(r.facts) }}</span>
            </span>
            <span class="shrink-0 text-right" data-cy="report-commissions-earned">
              <span v-if="r.pay" class="font-mono text-[14.5px] font-semibold tabular-nums text-ink-900">{{ formatEur(r.pay.totalCents) }}</span>
              <span v-else class="text-[12.5px] text-ink-faint">{{ t('No pay plan', 'Sin retribución') }}</span>
            </span>
            <AppChevron v-if="r.pay" :dir="open === r.member.id ? 'down' : 'right'" :size="16" class="shrink-0 text-ink-faint" />
          </button>
          <ul v-if="open === r.member.id && r.pay" class="mb-2.5 flex flex-col gap-1.5 rounded-ctl bg-surface-subtle px-3 py-2.5" data-cy="report-commissions-detail">
            <li v-for="l in r.pay.lines" :key="l.key" class="flex justify-between gap-4 text-[12.5px] text-ink-700">
              <span class="min-w-0">{{ t(LINE[l.key]![0], LINE[l.key]![1]) }}<span v-if="l.detail" class="ml-1.5 text-ink-faint">{{ l.detail }}</span></span>
              <span class="shrink-0 font-mono tabular-nums">{{ formatEur(l.cents) }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </ReportsModule>

    <p v-if="!loading && unattributedCents" class="px-1 text-[12.5px] text-ink-muted" data-cy="report-commissions-unattributed">
      {{ t(`${formatEur(unattributedCents)} of payments could not be attributed to anyone (no visit and no practitioner on the patient), so no % counts them.`, `${formatEur(unattributedCents)} de cobros no se pueden atribuir a nadie (sin visita ni profesional en el paciente), así que ningún % los cuenta.`) }}
    </p>
    <p class="px-1 text-[12.5px] text-ink-muted" data-cy="report-commissions-web-note">
      {{ t('Pay plans are set up and edited on the web, under Reports → Commissions.', 'Las retribuciones se configuran y editan en la web, en Informes → Comisiones.') }}
    </p>
  </ReportScreen>
</template>
