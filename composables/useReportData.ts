import type { InjectionKey } from 'vue'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import type { Appt, BonoData, LeadRow, MembershipRow, Money, MoneyLine, Names, Need, PatientRow, RecallRow, ReportData, SpendRow, WhatsappRow } from '~/utils/reportMetrics'

// The data behind a report page, loaded once for the whole page and shared by
// every block on it: ten blocks reading income are one set of requests, not
// ten. Sources that depend on the period (money, WhatsApp, leads) are loaded
// per period -- the page's, the comparison's, a block's own -- and kept.
//
// Each source is read the way the standard report it comes from reads it
// (see utils/reportMetrics.ts), under the viewer's own row-level security.

type Range = { from: Date; to: Date }
const rangeKey = (r: Range) => `${r.from.getTime()}-${r.to.getTime()}`

export interface ReportDataHub {
  /** Load what these needs require for these periods. Resolves once everything is there. */
  ensure: (needs: Need[], ranges: Range[]) => Promise<void>
  /** Sync access to what ensure() loaded. */
  data: ReportData
  /** Bumped whenever something arrives, for computeds to depend on. */
  version: Ref<number>
  /** Forget everything, so the next ensure() reads afresh. */
  reset: () => void
  /** Bumped by reset(): blocks watch it to load again. */
  generation: Ref<number>
}

export const REPORT_DATA_KEY: InjectionKey<ReportDataHub> = Symbol('report-data')

export function useReportDataHub(): ReportDataHub {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { labelFor, ensureLoaded: ensureMethods } = usePaymentMethods()
  const version = ref(0)
  const generation = ref(0)

  let pending = new Map<string, Promise<void>>()
  let appts: Appt[] = []
  let patients: PatientRow[] = []
  let bonos: BonoData = { purchases: [], invoicesById: new Map(), schedulesByPurchase: new Map(), payments: [] }
  let memberships: MembershipRow[] = []
  let recalls: RecallRow[] = []
  let carePlans: RecallRow[] = []
  let money = new Map<string, Money>()
  let whatsapp = new Map<string, WhatsappRow[]>()
  let leads = new Map<string, { leads: LeadRow[]; spend: SpendRow[]; defaultValueCents: number | null }>()
  const names: Names = { member: new Map(), clinic: new Map(), type: new Map(), service: new Map(), package: new Map(), method: (key) => labelFor(key) }
  const typeStage = new Map<string, string | null>()

  const emptyMoney = (): Money => ({ payments: [], invoices: [], appointmentById: new Map(), patientById: new Map(), paidByInvoice: new Map(), lines: [], purchaseById: new Map() })

  async function loadNames() {
    const [tm, cl, ty, sv, pk] = await Promise.all([
      supabase.from('team_members').select('id, full_name'),
      supabase.from('clinics').select('id, name'),
      supabase.from('appointment_types').select('id, name, stage'),
      supabase.from('services_products').select('id, name'),
      supabase.from('packages').select('id, name'),
      ensureMethods(),
    ])
    for (const m of tm.data ?? []) names.member.set(m.id, m.full_name)
    for (const c of cl.data ?? []) names.clinic.set(c.id, c.name)
    for (const tp of ty.data ?? []) {
      names.type.set(tp.id, tp.name)
      typeStage.set(tp.id, tp.stage)
    }
    for (const s of sv.data ?? []) names.service.set(s.id, s.name)
    for (const p of pk.data ?? []) names.package.set(p.id, p.name)
  }

  // Statistics' load: every appointment there has ever been, deleted ones
  // left out, ordered by id so the parallel pages cannot overlap.
  async function loadAppts() {
    await once('names', loadNames)
    type Row = Omit<Appt, 'at' | 'stage'> & { starts_at: string }
    const rows = await fetchAllRows<Row>(
      (f, t) =>
        supabase
          .from('appointments')
          .select('id, patient_id, starts_at, status, appointment_type_id, practitioner_id, clinic_id, source, confirmation_status')
          .is('deleted_at', null)
          .order('id')
          .range(f, t) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
      { total: supabase.from('appointments').select('id', { count: 'exact', head: true }).is('deleted_at', null) },
    )
    appts = rows.map(({ starts_at, ...a }) => ({ ...a, at: Date.parse(starts_at), stage: a.appointment_type_id ? (typeStage.get(a.appointment_type_id) ?? null) : null }))
  }

  // Income & Payments' load, embed for embed.
  async function loadMoney(r: Range) {
    interface PayRow {
      amount_cents: number
      method: string
      paid_at: string
      invoice_id: string | null
      patient_id: string | null
      invoices: { status: string; invoice_line_items: (MoneyLine & { package_purchases: { id: string; package_id: string | null; package_name: string } | null })[] } | null
      patients: { id: string; default_practitioner_id: string | null; clinic_id: string | null } | null
    }
    interface InvRow {
      id: string
      total_cents: number
      status: string
      appointment_id: string | null
      patient_id: string | null
      created_at: string
      appointments: { id: string; appointment_type_id: string | null; practitioner_id: string | null; clinic_id: string | null } | null
      payments: { invoice_id: string | null; amount_cents: number }[]
    }
    const [p, inv] = await Promise.all([
      fetchAllRows<PayRow>(
        (f, t) =>
          supabase
            .from('payments')
            .select(
              'amount_cents, method, paid_at, invoice_id, patient_id, invoices!payments_invoice_id_fkey(status, invoice_line_items(invoice_id, price_cents, quantity, service_id, package_purchase_id, package_purchases(id, package_id, package_name))), patients!payments_patient_id_fkey(id, default_practitioner_id, clinic_id)',
            )
            .gte('paid_at', r.from.toISOString())
            .lte('paid_at', r.to.toISOString())
            .order('id')
            .range(f, t) as unknown as PromiseLike<{ data: PayRow[] | null; error: unknown }>,
      ),
      fetchAllRows<InvRow>(
        (f, t) =>
          supabase
            .from('invoices')
            .select(
              'id, total_cents, status, appointment_id, patient_id, created_at, appointments!invoices_appointment_id_fkey(id, appointment_type_id, practitioner_id, clinic_id), payments!payments_invoice_id_fkey(invoice_id, amount_cents)',
            )
            .neq('status', 'void')
            .gte('created_at', r.from.toISOString())
            .lte('created_at', r.to.toISOString())
            .order('id')
            .range(f, t) as unknown as PromiseLike<{ data: InvRow[] | null; error: unknown }>,
      ),
    ])
    const m = emptyMoney()
    // The void rule after the query: the join is a left one, and a payment
    // with no invoice has nothing to void.
    const kept = p.filter((row) => row.invoices?.status !== 'void')
    const linesByInvoice = new Map<string, MoneyLine[]>()
    for (const row of kept) {
      m.payments.push({ amount_cents: row.amount_cents, method: row.method, at: Date.parse(row.paid_at), invoice_id: row.invoice_id, patient_id: row.patient_id })
      if (row.patients) m.patientById.set(row.patients.id, row.patients)
      if (row.invoice_id && row.invoices && !linesByInvoice.has(row.invoice_id)) {
        linesByInvoice.set(
          row.invoice_id,
          row.invoices.invoice_line_items.map(({ package_purchases: purchase, ...li }) => {
            if (purchase) m.purchaseById.set(purchase.id, { package_id: purchase.package_id, package_name: purchase.package_name })
            return li
          }),
        )
      }
    }
    m.lines = [...linesByInvoice.values()].flat()
    for (const i of inv) {
      m.invoices.push({ id: i.id, total_cents: i.total_cents, status: i.status, appointment_id: i.appointment_id, patient_id: i.patient_id, at: Date.parse(i.created_at) })
      if (i.appointments) m.appointmentById.set(i.appointments.id, i.appointments)
      for (const pay of i.payments) if (pay.invoice_id) m.paidByInvoice.set(pay.invoice_id, (m.paidByInvoice.get(pay.invoice_id) ?? 0) + pay.amount_cents)
    }
    money.set(rangeKey(r), m)
  }

  async function loadPatients() {
    patients = await fetchAllRows<PatientRow>(
      (f, t) =>
        supabase.from('patients').select('id, default_practitioner_id, clinic_id, referral_source, recall_status').order('id').range(f, t) as unknown as PromiseLike<{
          data: PatientRow[] | null
          error: unknown
        }>,
      { total: supabase.from('patients').select('id', { count: 'exact', head: true }) },
    )
  }

  async function loadBonos() {
    const [debts, closed] = await Promise.all([
      useBonoDebts()('id'),
      fetchAllRows<{ id: string; is_closed: boolean | null }>((f, t) => supabase.from('package_purchases').select('id, is_closed').order('id').range(f, t)),
    ])
    const closedById = new Map(closed.map((c) => [c.id, c.is_closed]))
    bonos = {
      purchases: debts.purchases.map((p) => ({ ...p, is_closed: closedById.get(p.id) ?? false })),
      invoicesById: debts.invoicesById,
      schedulesByPurchase: debts.schedulesByPurchase as Map<string, { status: string }>,
      payments: debts.payments,
    }
  }

  // The Memberships report's query, paged.
  async function loadMemberships() {
    interface Row {
      id: string
      membership_name: string
      status: string
      membership_payments: { period_start: string; amount_cents: number; status: string }[]
      payment_schedules: { stripe_payment_events: { period_start: string; amount_cents: number; status: string }[] }[]
    }
    const rows = await fetchAllRows<Row>(
      (f, t) =>
        supabase
          .from('patient_memberships')
          .select(
            'id, membership_name, status, membership_payments(period_start, amount_cents, status), payment_schedules!payment_schedules_patient_membership_id_fkey(stripe_payment_events(period_start, amount_cents, status))',
          )
          .order('id')
          .range(f, t) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
    )
    memberships = rows.map((m) => ({
      id: m.id,
      membership_name: m.membership_name,
      status: m.status,
      payments: [...m.membership_payments, ...m.payment_schedules.flatMap((s) => s.stripe_payment_events)],
    }))
  }

  async function loadWhatsapp(r: Range) {
    const rows = await fetchAllRows<{ created_at: string; status: string; purpose: string | null }>((f, t) =>
      supabase
        .from('whatsapp_messages')
        .select('created_at, status, purpose')
        .eq('direction', 'outbound')
        .gte('created_at', r.from.toISOString())
        .lte('created_at', r.to.toISOString())
        .order('id')
        .range(f, t),
    )
    whatsapp.set(
      rangeKey(r),
      rows.map((m) => ({ at: Date.parse(m.created_at), status: m.status, purpose: m.purpose })),
    )
  }

  async function loadLeads(r: Range) {
    type Row = { created_at: string; stage: string; furthest_stage: string | null; source: string | null; estimated_value_cents: number | null }
    const [rows, spend, account] = await Promise.all([
      fetchAllRows<Row>((f, t) =>
        supabase
          .from('leads')
          .select('created_at, stage, furthest_stage, source, estimated_value_cents')
          .is('deleted_at', null)
          .gte('created_at', r.from.toISOString())
          .lte('created_at', r.to.toISOString())
          .order('id')
          .range(f, t),
      ),
      supabase.from('channel_spend').select('channel, amount_cents, period_month'),
      store.accountId ? supabase.from('accounts').select('lead_default_value_cents').eq('id', store.accountId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    leads.set(rangeKey(r), {
      leads: rows.map((l) => ({ at: Date.parse(l.created_at), stage: l.stage, furthest_stage: l.furthest_stage, source: l.source, estimated_value_cents: l.estimated_value_cents })),
      spend: (spend.data ?? []) as SpendRow[],
      defaultValueCents: (account.data as { lead_default_value_cents: number | null } | null)?.lead_default_value_cents ?? null,
    })
  }

  async function loadRecalls() {
    recalls = await fetchAllRows<RecallRow>((f, t) =>
      supabase.from('recall_candidates').select('default_practitioner_id, clinic_id').order('patient_id').range(f, t) as unknown as PromiseLike<{ data: RecallRow[] | null; error: unknown }>,
    )
  }
  async function loadCarePlans() {
    carePlans = await fetchAllRows<RecallRow>((f, t) =>
      supabase.from('care_plan_continuity_alerts').select('default_practitioner_id').order('patient_id').range(f, t) as unknown as PromiseLike<{ data: RecallRow[] | null; error: unknown }>,
    )
  }

  function once(key: string, load: () => Promise<void>) {
    let p = pending.get(key)
    if (!p) {
      p = load().then(() => {
        version.value++
      })
      // A failed load is not remembered, so the next ensure() tries again.
      p.catch(() => pending.delete(key))
      pending.set(key, p)
    }
    return p
  }

  async function ensure(needs: Need[], ranges: Range[]) {
    const jobs: Promise<void>[] = [once('names', loadNames)]
    for (const need of new Set(needs)) {
      if (need === 'appts') jobs.push(once('appts', loadAppts))
      else if (need === 'patients') jobs.push(once('patients', loadPatients))
      else if (need === 'bonos') jobs.push(once('bonos', loadBonos))
      else if (need === 'memberships') jobs.push(once('memberships', loadMemberships))
      else if (need === 'recalls') jobs.push(once('recalls', loadRecalls))
      else if (need === 'carePlans') jobs.push(once('carePlans', loadCarePlans))
      else
        for (const r of ranges) {
          const key = `${need}:${rangeKey(r)}`
          if (need === 'money') jobs.push(once(key, () => loadMoney(r)))
          else if (need === 'whatsapp') jobs.push(once(key, () => loadWhatsapp(r)))
          else if (need === 'leads') jobs.push(once(key, () => loadLeads(r)))
        }
    }
    await Promise.all(jobs)
  }

  // A part of a period already loaded -- one month of a page's year, when a
  // figure is computed month by month -- is read from that period rather
  // than fetched again.
  function within<T>(cache: Map<string, T>, from: Date, to: Date, cut: (value: T) => T): T | undefined {
    for (const [key, value] of cache) {
      const [a, b] = key.split('-').map(Number)
      if (a! <= from.getTime() && b! >= to.getTime()) return cut(value)
    }
    return undefined
  }
  function cutMoney(m: Money, from: Date, to: Date): Money {
    const inside = (at: number) => at >= from.getTime() && at <= to.getTime()
    const payments = m.payments.filter((p) => inside(p.at))
    const settled = new Set(payments.map((p) => p.invoice_id))
    return { ...m, payments, invoices: m.invoices.filter((i) => inside(i.at)), lines: m.lines.filter((li) => settled.has(li.invoice_id)) }
  }

  const data: ReportData = {
    get appts() {
      return appts
    },
    money: (from, to) => money.get(rangeKey({ from, to })) ?? within(money, from, to, (m) => cutMoney(m, from, to)) ?? emptyMoney(),
    get patients() {
      return patients
    },
    get bonos() {
      return bonos
    },
    get memberships() {
      return memberships
    },
    whatsapp: (from, to) => whatsapp.get(rangeKey({ from, to })) ?? within(whatsapp, from, to, (rows) => rows.filter((m) => m.at >= from.getTime() && m.at <= to.getTime())) ?? [],
    leads: (from, to) =>
      leads.get(rangeKey({ from, to })) ??
      within(leads, from, to, (l) => ({ ...l, leads: l.leads.filter((x) => x.at >= from.getTime() && x.at <= to.getTime()) })) ?? { leads: [], spend: [], defaultValueCents: null },
    get recalls() {
      return recalls
    },
    get carePlans() {
      return carePlans
    },
    names,
  }

  function reset() {
    pending = new Map()
    money = new Map()
    whatsapp = new Map()
    leads = new Map()
    appts = []
    patients = []
    memberships = []
    recalls = []
    carePlans = []
    version.value++
    generation.value++
  }

  return { ensure, data, version, reset, generation }
}
