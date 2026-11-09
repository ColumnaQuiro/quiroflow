<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { currentContract, employmentTypeLabel, type StaffContract } from '~/utils/staffContracts'
import { profitability, type ProfitRow } from '~/utils/staffProfitability'
import { formatWorked, workdaysOf, workdayMonthBounds, type WorkEntry } from '~/utils/workday'
import { loadPayMonth, type PayMonth } from '~/composables/usePayMonth'

// Rentabilidad por profesional: what each practitioner brings in beside what
// they cost, a month at a time (utils/staffProfitability.ts says how each
// figure is reached). Owners only -- the route rule and the RLS on
// staff_monthly_costs and pay_plans both say so. Coste empresa is typed in
// here from the gestoría's figures; without it the cost is estimated from
// the pay plan and marked as such.
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { timeZone } = useAccountTimeZone()
const tz = computed(() => timeZone.value || DEFAULT_CLINIC_TIMEZONE)

const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const month = ref(lastMonth())

const pay = ref<PayMonth | null>(null)
const costs = ref<Map<string, number>>(new Map())
const types = ref<Map<string, string>>(new Map())
const minutes = ref<Map<string, number>>(new Map())
const loading = ref(true)
const error = ref('')
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  if (!store.accountId) await store.load()
  const accountId = store.accountId!
  const { first, last } = workdayMonthBounds(month.value)
  const [p, c, con, es] = await Promise.all([
    loadPayMonth(supabase, month.value, tz.value),
    supabase.from('staff_monthly_costs').select('team_member_id, cost_cents').eq('account_id', accountId).eq('month', first),
    supabase.from('staff_contracts').select('id, team_member_id, employment_type, modality, starts_on, ends_on, weekly_hours, job_title, convenio, created_at').eq('account_id', accountId),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date').eq('account_id', accountId).is('superseded_by', null).gte('work_date', first).lte('work_date', last).order('at'),
  ])
  if (mine !== run) return
  error.value = c.error || es.error ? t("Couldn't load the month.", 'No se ha podido cargar el mes.') : ''
  pay.value = p
  costs.value = new Map(((c.data as { team_member_id: string; cost_cents: number }[] | null) ?? []).map((r) => [r.team_member_id, Number(r.cost_cents)]))
  const byMember = new Map<string, StaffContract[]>()
  for (const k of (con.data as StaffContract[] | null) ?? []) byMember.set(k.team_member_id, [...(byMember.get(k.team_member_id) ?? []), k])
  types.value = new Map([...byMember].map(([id, list]) => [id, currentContract(list, last)?.employment_type ?? 'employee']))
  const entries = (es.data as (WorkEntry & { team_member_id: string })[] | null) ?? []
  const byPerson = new Map<string, number>()
  for (const id of new Set(entries.map((e) => e.team_member_id))) byPerson.set(id, workdaysOf(entries.filter((e) => e.team_member_id === id)).reduce((s, d) => s + d.workedMinutes, 0))
  minutes.value = byPerson
  loading.value = false
}
onMounted(load)
watch(month, load)

const result = computed(() =>
  pay.value
    ? profitability({ members: pay.value.members, employmentType: types.value, plans: pay.value.plans, facts: pay.value.facts, costs: costs.value, minutesClocked: minutes.value })
    : null,
)
const totals = computed(() => {
  const r = result.value
  if (!r) return null
  const income = r.practitioners.reduce((s, p) => s + p.incomeCents, 0)
  const cost = r.practitioners.reduce((s, p) => s + (p.costCents ?? 0), 0) + r.frontDesk.costCents
  return { income, cost, margin: income - cost }
})

// ---- typing in coste empresa
const editing = ref<string | null>(null)
const draft = ref('')
const saveError = ref('')
function startEdit(id: string) {
  editing.value = id
  const c = costs.value.get(id)
  draft.value = c === undefined ? '' : (c / 100).toFixed(2).replace('.', ',')
  saveError.value = ''
}
async function saveCost(id: string) {
  const first = `${month.value}-01`
  saveError.value = ''
  if (!draft.value.trim()) {
    const { error: e } = await supabase.from('staff_monthly_costs').delete().eq('team_member_id', id).eq('month', first)
    if (e) return (saveError.value = e.message)
  } else {
    const cents = parseEurosToCents(draft.value)
    if (cents === null || Number.isNaN(cents) || cents < 0) return (saveError.value = t('An amount in euros, like 2150,40.', 'Un importe en euros, como 2150,40.'))
    const { error: e } = await supabase.from('staff_monthly_costs').upsert({ account_id: store.accountId!, team_member_id: id, month: first, cost_cents: cents, updated_at: new Date().toISOString() })
    if (e) return (saveError.value = e.message)
  }
  editing.value = null
  await load()
}

const pct = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)} %`)
const money = (c: number | null) => (c === null ? '—' : formatEur(c))
function costTitle(r: Pick<ProfitRow, 'costSource' | 'employmentType'>) {
  if (r.costSource === 'estimated') return t('Estimated from the pay plan (fixed + variable). It leaves out Social Security, so it reads low.', 'Estimado con su retribución (fijo + variable). No incluye la Seguridad Social, así que se queda corto.')
  if (r.costSource === 'entered' && r.employmentType !== 'employee') return t('What their pay plan came to: what they invoice.', 'Lo que sale de su retribución: lo que facturan.')
  return ''
}
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2'
const td = 'whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink-800'
const inputClass = 'h-8 w-28 rounded-ctl border border-line-control bg-surface px-2 text-right font-mono text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Profitability by practitioner', 'Rentabilidad por profesional')" :meta="t('What each practitioner brings in, beside what they cost', 'Lo que aporta cada profesional, frente a lo que cuesta')">
      <ReportsBackLink />
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="profitability" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-3">
        <input v-model="month" type="month" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 touch:h-11" :aria-label="t('Month', 'Mes')" data-cy="profitability-month" />
        <span v-if="totals" class="ml-auto text-[13px] text-ink-700">{{ t('Margin', 'Margen') }}: <strong class="font-mono text-[15px]" :class="totals.margin < 0 ? 'text-danger-text' : 'text-ink-900'" data-cy="profitability-total-margin">{{ formatEur(totals.margin) }}</strong></span>
      </div>
      <p v-if="error" role="alert" class="mt-3 text-[13px] text-danger-text">{{ error }}</p>
      <p v-if="saveError" role="alert" class="mt-3 text-[13px] text-danger-text" data-cy="profitability-save-error">{{ saveError }}</p>

      <div class="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <div v-if="loading" class="space-y-2 p-4"><UiSkeleton v-for="i in 4" :key="i" class="h-10 w-full rounded-ctl" /></div>
        <table v-else-if="result" class="w-full min-w-[880px]">
          <thead class="border-b border-line bg-surface-subtle">
            <tr>
              <th :class="th">{{ t('Practitioner', 'Profesional') }}</th>
              <th :class="th">{{ t('Income', 'Ingresos') }}</th>
              <th :class="th">{{ t('Visits', 'Visitas') }}</th>
              <th :class="th">{{ t('Cost', 'Coste') }}</th>
              <th :class="th">{{ t('Margin', 'Margen') }}</th>
              <th :class="th">{{ t('Per visit', 'Por visita') }}</th>
              <th :class="th">{{ t('Per hour', 'Por hora') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="!result.practitioners.length"><td colspan="7" class="px-3 py-4 text-[13px] text-ink-muted">{{ t('No practitioners on the team.', 'No hay profesionales en el equipo.') }}</td></tr>
            <tr v-for="r in result.practitioners" :key="r.id" data-cy="profitability-row" :data-name="r.name">
              <td class="px-3 py-2.5 text-[13.5px] font-medium text-ink-900">
                {{ r.name }}
                <span class="block text-[12px] font-normal text-ink-muted">{{ employmentTypeLabel(r.employmentType, t) }}</span>
              </td>
              <td :class="td" data-cy="profitability-income">{{ formatEur(r.incomeCents) }}</td>
              <td :class="td">{{ r.visits }}</td>
              <td :class="td" data-cy="profitability-cost">
                <form v-if="editing === r.id" class="flex items-center gap-1.5" @submit.prevent="saveCost(r.id)">
                  <input v-model="draft" inputmode="decimal" :class="inputClass" :aria-label="t(`Cost to the clinic for ${r.name}`, `Coste empresa de ${r.name}`)" data-cy="profitability-cost-input" />
                  <UiBtn size="sm" variant="primary" type="submit" data-cy="profitability-cost-save">{{ t('Save', 'Guardar') }}</UiBtn>
                  <UiBtn size="sm" variant="ghost" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                </form>
                <template v-else>
                  <span :title="costTitle(r)">{{ money(r.costCents) }}</span>
                  <UiPill v-if="r.costSource === 'estimated'" tone="warning" class="ml-1.5 font-sans" data-cy="profitability-estimated">{{ t('estimated', 'estimado') }}</UiPill>
                  <button v-if="r.employmentType === 'employee'" type="button" class="ml-2 font-sans text-[12px] font-semibold text-brand-text hover:underline" data-cy="profitability-cost-edit" @click="startEdit(r.id)">{{ costs.has(r.id) ? t('Change', 'Cambiar') : t('Enter cost', 'Poner coste') }}</button>
                </template>
              </td>
              <td :class="td" data-cy="profitability-margin">
                <span :class="(r.marginCents ?? 0) < 0 ? 'text-danger-text' : ''">{{ money(r.marginCents) }}</span>
                <span v-if="r.marginShare !== null" class="ml-1 text-ink-muted">{{ pct(r.marginShare) }}</span>
              </td>
              <td :class="td">{{ money(r.incomePerVisitCents) }} <span class="text-ink-muted">/ {{ money(r.costPerVisitCents) }}</span></td>
              <td :class="td" :title="t(`${formatWorked(r.minutesClocked)} clocked`, `${formatWorked(r.minutesClocked)} fichadas`)">{{ money(r.incomePerHourCents) }}</td>
            </tr>
            <tr v-if="result.frontDesk.people.length" class="bg-surface-subtle/60" data-cy="profitability-front-desk">
              <td class="px-3 py-2.5 text-[13.5px] font-medium text-ink-900">
                {{ t('Front desk and others', 'Recepción y resto') }}
                <span class="block text-[12px] font-normal text-ink-muted">{{ result.frontDesk.people.map((p) => p.name).join(', ') }}</span>
              </td>
              <td :class="td">—</td>
              <td :class="td">—</td>
              <td :class="td">
                {{ formatEur(result.frontDesk.costCents) }}
                <UiPill v-if="result.frontDesk.estimated" tone="warning" class="ml-1.5 font-sans">{{ t('estimated', 'estimado') }}</UiPill>
                <span class="block font-sans text-[12px]">
                  <button v-for="p in result.frontDesk.people" :key="p.id" type="button" class="mr-2 font-semibold text-brand-text hover:underline" data-cy="profitability-front-desk-edit" @click="startEdit(p.id)">{{ p.name }}</button>
                </span>
                <form v-if="editing && result.frontDesk.people.some((p) => p.id === editing)" class="mt-1 flex items-center gap-1.5" @submit.prevent="saveCost(editing!)">
                  <input v-model="draft" inputmode="decimal" :class="inputClass" :aria-label="t('Cost to the clinic', 'Coste empresa')" />
                  <UiBtn size="sm" variant="primary" type="submit">{{ t('Save', 'Guardar') }}</UiBtn>
                </form>
              </td>
              <td :class="td" colspan="3" />
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-[12.5px] text-ink-muted">{{ t('Income: payments received, attributed as in Income and Commissions. Cost: the month’s cost to the clinic from the gestoría; without it, the pay plan, which leaves out Social Security. Per visit: income / cost. Per hour: income over the hours clocked.', 'Ingresos: cobros recibidos, atribuidos como en Ingresos y Comisiones. Coste: el coste empresa del mes según la gestoría; sin él, la retribución, que no incluye la Seguridad Social. Por visita: ingresos / coste. Por hora: ingresos entre las horas fichadas.') }}</p>
    </div>
  </div>
</template>
