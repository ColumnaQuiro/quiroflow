import { bonoOwedCents, type BonoOwedPayment } from './bonoOwed'
import { classifyPaymentForFilter, practitionerForPayment } from './incomeAttribution'
import { isReceipt } from './paymentReceipts'
import type { SplitKey } from './reportBlocks'

// Every metric a report page can show, and how each is computed.
//
// Each one follows the standard report it comes from, rule for rule, so a
// block on a report page shows the same number as the report beside it:
//
//   visits, stages, PVA, conversion, retention  -- Statistics
//   show rate, shifts, hours                    -- Appointment Distribution
//   income, charged, outstanding, by service    -- Income & Payments
//   bono debt                                   -- Debtors
//   memberships                                 -- Memberships
//   WhatsApp, confirmations                     -- Scheduled Reminders
//   leads, spend, ROAS                          -- Growth
//
// including their quirks, which are commented where they are copied. The
// one deliberate difference: soft-deleted appointments are left out
// everywhere, as Statistics does. The other appointment reports count them.
//
// Pure functions over data loaded by composables/useReportData.ts, so they
// can be tested without a browser.

// ---- Data -----------------------------------------------------------------

export interface Appt {
  id: string
  patient_id: string
  /** starts_at, epoch ms */
  at: number
  status: string
  appointment_type_id: string | null
  practitioner_id: string | null
  clinic_id: string | null
  source: string
  confirmation_status: string | null
  stage: string | null
}

export interface MoneyPayment {
  amount_cents: number
  method: string
  /** paid_at, epoch ms */
  at: number
  invoice_id: string | null
  patient_id: string | null
}
export interface MoneyInvoice {
  id: string
  total_cents: number
  status: string
  appointment_id: string | null
  patient_id: string | null
  /** created_at, epoch ms */
  at: number
}
export interface MoneyLine {
  invoice_id: string
  price_cents: number
  quantity: number
  service_id: string | null
  package_purchase_id: string | null
}
/** One period's money, loaded the way Income & Payments loads it. */
export interface Money {
  payments: MoneyPayment[]
  invoices: MoneyInvoice[]
  /** The visits behind the period's own invoices only (Income's rule). */
  appointmentById: Map<string, { practitioner_id: string | null; clinic_id: string | null; appointment_type_id: string | null }>
  /** The patients behind the period's payments only (Income's rule). */
  patientById: Map<string, { default_practitioner_id: string | null; clinic_id: string | null }>
  /** Every payment ever made against the period's invoices. */
  paidByInvoice: Map<string, number>
  /** Line items of the invoices the period's payments settle, once per invoice. */
  lines: MoneyLine[]
  purchaseById: Map<string, { package_id: string | null; package_name: string }>
}

export interface PatientRow {
  id: string
  default_practitioner_id: string | null
  clinic_id: string | null
  referral_source: string | null
  recall_status: string | null
}

export interface BonoData {
  purchases: { id: string; patient_id: string; package_name: string; sessions_total: number; sessions_used: number; price_cents: number; purchased_at: string; invoice_id: string | null; owed_cents: number | null; is_closed?: boolean | null }[]
  invoicesById: Map<string, { status: string; total_cents: number }>
  schedulesByPurchase: Map<string, { status: string }>
  payments: BonoOwedPayment[]
}

export interface MembershipRow {
  id: string
  membership_name: string
  status: string
  /** paid or failed, from both manual payments and Stripe. */
  payments: { period_start: string; amount_cents: number; status: string }[]
}

export interface WhatsappRow {
  at: number
  status: string
  purpose: string | null
}

export interface LeadRow {
  at: number
  stage: string
  furthest_stage: string | null
  source: string | null
  estimated_value_cents: number | null
}
export interface SpendRow {
  channel: string
  amount_cents: number
  /** yyyy-mm-dd, the 1st of the month */
  period_month: string
}

export interface RecallRow {
  default_practitioner_id: string | null
  clinic_id: string | null
}

/** What a computation may read. Whatever the metric needs has been loaded. */
export interface ReportData {
  appts: Appt[]
  money: (from: Date, to: Date) => Money
  patients: PatientRow[]
  bonos: BonoData
  memberships: MembershipRow[]
  whatsapp: (from: Date, to: Date) => WhatsappRow[]
  leads: (from: Date, to: Date) => { leads: LeadRow[]; spend: SpendRow[]; defaultValueCents: number | null }
  recalls: RecallRow[]
  carePlans: RecallRow[]
  names: Names
}

export interface Names {
  member: Map<string, string>
  clinic: Map<string, string>
  type: Map<string, string>
  service: Map<string, string>
  package: Map<string, string>
  method: (key: string) => string
}

export type Need = 'appts' | 'money' | 'patients' | 'bonos' | 'memberships' | 'whatsapp' | 'leads' | 'recalls' | 'carePlans'

export interface Ctx {
  from: Date
  to: Date
  practitionerId?: string | null
  clinicId?: string | null
  method?: string | null
  now: Date
  t: (en: string, es: string) => string
}

// ---- Metric definitions ---------------------------------------------------

export type Unit = 'count' | 'eur' | 'pct' | 'decimal' | 'times'
export type Area = 'visits' | 'patients' | 'money' | 'packages' | 'messages' | 'growth'

interface Rec {
  at?: number
  dims: Partial<Record<SplitKey, string>>
  /** numerator (or the amount) */
  v: number
  /** denominator, for a rate */
  d?: number
  /** counted once per group, for "patients" */
  p?: string
}

export interface MetricDef {
  key: string
  area: Area
  label: [string, string]
  description: [string, string]
  unit: Unit
  splits: SplitKey[]
  needs: Need[]
  /** A count as of now, not over a period: the period and comparison do not apply. */
  snapshot?: boolean
  /** About the whole clinic; cannot be narrowed to one practitioner. */
  clinicWide?: boolean
  /** The permission its data needs, beyond Reports (RLS returns nothing without it). */
  permission?: 'billing' | 'inbox' | 'growth'
  /** Records, summed per group (or a rate of sums, or distinct patients). */
  records?: (data: ReportData, ctx: Ctx, split: SplitKey) => Rec[]
  reduce?: 'sum' | 'rate' | 'distinct'
  /** For figures that are not a sum of parts: computed again for each group. */
  value?: (data: ReportData, ctx: Ctx) => number | null
  /** For a funnel. */
  steps?: (data: ReportData, ctx: Ctx) => { label: string; value: number }[]
}

const TIME: SplitKey[] = ['month', 'week', 'day']
const VISIT_DIMS: SplitKey[] = ['weekday', 'hour', 'shift', 'practitioner', 'clinic', 'appointment_type', 'stage']

// Appointment Distribution's shifts, by local hour.
export function shiftOf(hour: number) {
  return hour < 12 ? 'morning' : hour < 16 ? 'afternoon' : 'evening'
}

function inRange(at: number, ctx: Ctx) {
  return at >= ctx.from.getTime() && at <= ctx.to.getTime()
}

/** Statistics' rule: the practitioner and clinic filters apply to the whole history first. */
function filteredAppts(data: ReportData, ctx: Ctx) {
  if (!ctx.practitionerId && !ctx.clinicId) return data.appts
  return data.appts.filter((a) => (!ctx.practitionerId || a.practitioner_id === ctx.practitionerId) && (!ctx.clinicId || a.clinic_id === ctx.clinicId))
}

function apptDims(a: Appt): Rec['dims'] {
  return {
    practitioner: a.practitioner_id ?? '',
    clinic: a.clinic_id ?? '',
    appointment_type: a.appointment_type_id ?? '',
    stage: a.stage ?? '',
    status: a.status,
    booked_via: a.source,
  }
}
const apptRec = (a: Appt, v = 1, d?: number): Rec => ({ at: a.at, dims: apptDims(a), v, d })

/** patient -> stage -> their completed visits at that stage, oldest first. */
function byPatientStage(completed: Appt[]) {
  const index = new Map<string, Map<string, Appt[]>>()
  for (const a of [...completed].sort((x, y) => x.at - y.at)) {
    if (!a.stage) continue
    let byStage = index.get(a.patient_id)
    if (!byStage) index.set(a.patient_id, (byStage = new Map()))
    const list = byStage.get(a.stage)
    if (list) list.push(a)
    else byStage.set(a.stage, [a])
  }
  return index
}

/** Statistics' stepConversion: of patients whose first `fromStage` is in the period, how many later had a `toStage`. */
function stepConversion(data: ReportData, ctx: Ctx, fromStage: string, toStage: string) {
  const completed = filteredAppts(data, ctx).filter((a) => a.status === 'completed')
  let reached = 0
  let converted = 0
  for (const byStage of byPatientStage(completed).values()) {
    const start = byStage.get(fromStage)?.[0]
    if (!start || !inRange(start.at, ctx)) continue
    reached++
    if (byStage.get(toStage)?.some((a) => a.at > start.at)) converted++
  }
  return reached === 0 ? null : Math.round((converted / reached) * 100)
}

function pvaParts(data: ReportData, ctx: Ctx) {
  let visits = 0
  const newPatients = new Set<string>()
  for (const a of filteredAppts(data, ctx)) {
    if (a.status !== 'completed' || !inRange(a.at, ctx)) continue
    visits++
    if (a.stage === 'first_visit' || a.stage === 'first_visit_offer') newPatients.add(a.patient_id)
  }
  return { visits, newPatients: newPatients.size }
}

// Income's classify(): the visit behind a payment is found only through the
// period's own invoices, and failing that the patient's own practitioner.
function moneyClassify(m: Money, ctx: Ctx, appointmentId: string | null, patientId: string | null) {
  return classifyPaymentForFilter({
    practitionerId: ctx.practitionerId || undefined,
    clinicId: ctx.clinicId || undefined,
    appointment: appointmentId ? (m.appointmentById.get(appointmentId) ?? null) : null,
    patient: patientId ? (m.patientById.get(patientId) ?? null) : null,
  })
}
function invoiceAppointment(m: Money) {
  const byId = new Map(m.invoices.map((i) => [i.id, i.appointment_id]))
  return (invoiceId: string | null) => (invoiceId ? (byId.get(invoiceId) ?? null) : null)
}
function moneyDims(m: Money, appointmentId: string | null, patientId: string | null, method?: string): Rec['dims'] {
  const appointment = appointmentId ? (m.appointmentById.get(appointmentId) ?? null) : null
  const patient = patientId ? (m.patientById.get(patientId) ?? null) : null
  return {
    practitioner: practitionerForPayment({ appointment, patient }) ?? '',
    clinic: (appointment ? appointment.clinic_id : patient?.clinic_id) ?? '',
    ...(method ? { method } : {}),
  }
}

function filteredPayments(data: ReportData, ctx: Ctx) {
  const m = data.money(ctx.from, ctx.to)
  const apptOf = invoiceAppointment(m)
  return {
    m,
    apptOf,
    payments: m.payments.filter((p) => moneyClassify(m, ctx, apptOf(p.invoice_id), p.patient_id) === 'matches' && (!ctx.method || p.method === ctx.method)),
  }
}

/** Income's lineLabel: the service, else the bono's template, else the visit type behind the invoice. */
function lineService(data: ReportData, m: Money, li: MoneyLine) {
  if (li.service_id) return `service:${li.service_id}`
  if (li.package_purchase_id) {
    const purchase = m.purchaseById.get(li.package_purchase_id)
    if (purchase) return purchase.package_id && data.names.package.has(purchase.package_id) ? `package:${purchase.package_id}` : `name:${purchase.package_name}`
  }
  const inv = m.invoices.find((i) => i.id === li.invoice_id)
  const typeId = inv?.appointment_id ? m.appointmentById.get(inv.appointment_id)?.appointment_type_id : null
  if (typeId && data.names.type.has(typeId)) return `type:${typeId}`
  return ''
}

function monthOfDate(yyyyMmDd: string) {
  return yyyyMmDd.slice(0, 7)
}
function monthKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const LEAD_FUNNEL = ['new', 'contacted', 'qualified', 'booked', 'showed', 'converted']
const leadRank = (stage: string | null) => LEAD_FUNNEL.indexOf(stage ?? '')
/** Growth's channelOf: the text before '·', or Direct. */
export function leadChannel(source: string | null) {
  if (!source) return 'Direct'
  return source.split('·')[0]!.trim() || 'Direct'
}

function spendIn(rows: SpendRow[], ctx: Ctx) {
  const first = monthKeyOf(ctx.from)
  const last = monthKeyOf(ctx.to)
  return rows.filter((s) => monthOfDate(s.period_month) >= first && monthOfDate(s.period_month) <= last)
}

export const METRICS: MetricDef[] = [
  // --- Visits ----------------------------------------------------------------
  {
    key: 'visits_booked',
    area: 'visits',
    label: ['Visits booked', 'Citas reservadas'],
    description: ['Every appointment in the period, whatever became of it', 'Todas las citas del periodo, pase lo que pase con ellas'],
    unit: 'count',
    splits: ['none', ...TIME, ...VISIT_DIMS, 'status', 'booked_via'],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => inRange(a.at, ctx)).map((a) => apptRec(a)),
  },
  {
    key: 'visits_completed',
    area: 'visits',
    label: ['Completed visits', 'Visitas completadas'],
    description: ['Appointments marked completed', 'Citas marcadas como completadas'],
    unit: 'count',
    splits: ['none', ...TIME, ...VISIT_DIMS],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => a.status === 'completed' && inRange(a.at, ctx)).map((a) => apptRec(a)),
  },
  {
    key: 'first_visits',
    area: 'visits',
    label: ['First visits', 'Primeras visitas'],
    description: ['Completed visits of a "first visit" type (Appointment Types › stage)', 'Visitas completadas de un tipo de "primera visita" (Tipos de cita › etapa)'],
    unit: 'count',
    splits: ['none', ...TIME, 'weekday', 'shift', 'practitioner', 'clinic', 'appointment_type'],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => a.status === 'completed' && a.stage === 'first_visit' && inRange(a.at, ctx)).map((a) => apptRec(a)),
  },
  {
    key: 'show_rate',
    area: 'visits',
    label: ['Show rate', 'Tasa de asistencia'],
    description: ['Completed ÷ (completed + no-show). Cancelled and still-booked visits are left out', 'Completadas ÷ (completadas + no presentadas). Las canceladas y las aún reservadas no cuentan'],
    unit: 'pct',
    splits: ['none', ...TIME, ...VISIT_DIMS],
    needs: ['appts'],
    reduce: 'rate',
    records: (data, ctx) =>
      filteredAppts(data, ctx)
        .filter((a) => (a.status === 'completed' || a.status === 'no_show') && inRange(a.at, ctx))
        .map((a) => apptRec(a, a.status === 'completed' ? 1 : 0, 1)),
  },
  {
    key: 'no_show_rate',
    area: 'visits',
    label: ['No-show rate', 'Tasa de no presentados'],
    description: ['No-shows ÷ (completed + no-show)', 'No presentados ÷ (completadas + no presentadas)'],
    unit: 'pct',
    splits: ['none', ...TIME, ...VISIT_DIMS],
    needs: ['appts'],
    reduce: 'rate',
    records: (data, ctx) =>
      filteredAppts(data, ctx)
        .filter((a) => (a.status === 'completed' || a.status === 'no_show') && inRange(a.at, ctx))
        .map((a) => apptRec(a, a.status === 'no_show' ? 1 : 0, 1)),
  },
  {
    key: 'no_shows',
    area: 'visits',
    label: ['No-shows', 'No presentados'],
    description: ['Appointments marked no-show', 'Citas marcadas como no presentado'],
    unit: 'count',
    splits: ['none', ...TIME, ...VISIT_DIMS],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => a.status === 'no_show' && inRange(a.at, ctx)).map((a) => apptRec(a)),
  },
  {
    key: 'cancellations',
    area: 'visits',
    label: ['Cancellations', 'Cancelaciones'],
    description: ['Cancelled appointments in the period. When they were cancelled is not recorded, so notice is not available', 'Citas canceladas del periodo. No se guarda cuándo se cancelaron, así que la antelación no está disponible'],
    unit: 'count',
    splits: ['none', ...TIME, ...VISIT_DIMS],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => a.status === 'cancelled' && inRange(a.at, ctx)).map((a) => apptRec(a)),
  },
  {
    key: 'visits_daily_average',
    area: 'visits',
    label: ['Daily average', 'Media diaria'],
    description: ['Visits booked ÷ days in the period', 'Citas reservadas ÷ días del periodo'],
    unit: 'decimal',
    splits: ['none', 'month', 'practitioner', 'clinic'],
    needs: ['appts'],
    value: (data, ctx) => {
      const days = Math.max(1, Math.round((ctx.to.getTime() - ctx.from.getTime()) / 86_400_000))
      return filteredAppts(data, ctx).filter((a) => inRange(a.at, ctx)).length / days
    },
  },
  {
    key: 'online_bookings',
    area: 'visits',
    label: ['Online bookings', 'Reservas online'],
    description: ['Booked by the patient: the booking page, the app, or the API', 'Reservadas por el paciente: la página de reservas, la app o la API'],
    unit: 'count',
    splits: ['none', ...TIME, 'booked_via', 'practitioner', 'clinic', 'appointment_type'],
    needs: ['appts'],
    records: (data, ctx) => filteredAppts(data, ctx).filter((a) => a.source !== 'staff' && inRange(a.at, ctx)).map((a) => apptRec(a)),
  },

  // --- Patients --------------------------------------------------------------
  {
    key: 'new_patients',
    area: 'patients',
    label: ['New patients', 'Pacientes nuevos'],
    description: ['Patients with a completed first visit in the period, each counted once', 'Pacientes con una primera visita completada en el periodo, cada uno una vez'],
    unit: 'count',
    splits: ['none', ...TIME, 'practitioner', 'clinic', 'appointment_type', 'referral_source'],
    needs: ['appts', 'patients'],
    reduce: 'distinct',
    records: (data, ctx) => {
      const referral = new Map(data.patients.map((p) => [p.id, p.referral_source ?? '']))
      return filteredAppts(data, ctx)
        .filter((a) => a.status === 'completed' && (a.stage === 'first_visit' || a.stage === 'first_visit_offer') && inRange(a.at, ctx))
        .map((a) => ({ ...apptRec(a), dims: { ...apptDims(a), referral_source: referral.get(a.patient_id) ?? '' }, p: a.patient_id }))
    },
  },
  {
    key: 'active_patients',
    area: 'patients',
    label: ['Active patients', 'Pacientes activos'],
    description: ['Patients with a completed visit in the last 90 days', 'Pacientes con una visita completada en los últimos 90 días'],
    unit: 'count',
    splits: ['none', 'practitioner', 'clinic'],
    needs: ['appts'],
    snapshot: true,
    reduce: 'distinct',
    records: (data, ctx) => {
      const since = ctx.now.getTime() - 90 * 86_400_000
      return filteredAppts(data, ctx)
        .filter((a) => a.status === 'completed' && a.at >= since)
        .map((a) => ({ ...apptRec(a), p: a.patient_id }))
    },
  },
  {
    key: 'total_patients',
    area: 'patients',
    label: ['Total patients', 'Pacientes totales'],
    description: ['Patient records (by their own practitioner and clinic)', 'Fichas de paciente (por su profesional y clínica)'],
    unit: 'count',
    splits: ['none', 'practitioner', 'clinic', 'referral_source', 'status'],
    needs: ['patients'],
    snapshot: true,
    records: (data, ctx) =>
      data.patients
        .filter((p) => (!ctx.practitionerId || p.default_practitioner_id === ctx.practitionerId) && (!ctx.clinicId || p.clinic_id === ctx.clinicId))
        .map((p) => ({ dims: { practitioner: p.default_practitioner_id ?? '', clinic: p.clinic_id ?? '', referral_source: p.referral_source ?? '', status: p.recall_status ?? '' }, v: 1 })),
  },
  {
    key: 'pva',
    area: 'patients',
    label: ['PVA (visits per new patient)', 'PVA (visitas por paciente nuevo)'],
    description: ['Completed visits ÷ new patients, as Statistics measures it', 'Visitas completadas ÷ pacientes nuevos, como en Estadísticas'],
    unit: 'decimal',
    splits: ['none', 'month', 'week', 'practitioner', 'clinic'],
    needs: ['appts'],
    value: (data, ctx) => {
      const { visits, newPatients } = pvaParts(data, ctx)
      return newPatients === 0 ? null : visits / newPatients
    },
  },
  {
    key: 'conversion_third_visit',
    area: 'patients',
    label: ['Conversion to 3rd visit', 'Conversión a la 3.ª visita'],
    description: ['Of patients given their report in the period, how many came back for an adjustment', 'De los pacientes con informe en el periodo, cuántos volvieron a un ajuste'],
    unit: 'pct',
    splits: ['none', 'month', 'practitioner', 'clinic'],
    needs: ['appts'],
    value: (data, ctx) => stepConversion(data, ctx, 'report', 'adjustment'),
  },
  {
    key: 'retention_post_revision',
    area: 'patients',
    label: ['Retention post-revision', 'Retención tras revisión'],
    description: ['Of patients with their first revision in the period, how many went on to maintenance', 'De los pacientes con su primera revisión en el periodo, cuántos pasaron a mantenimiento'],
    unit: 'pct',
    splits: ['none', 'month', 'practitioner', 'clinic'],
    needs: ['appts'],
    value: (data, ctx) => stepConversion(data, ctx, 'revision', 'maintenance'),
  },
  {
    key: 'overall_retention',
    area: 'patients',
    label: ['Overall retention', 'Retención general'],
    description: ['Of patients seen in the period, the share also seen before it', 'De los pacientes atendidos en el periodo, los que ya venían antes'],
    unit: 'pct',
    splits: ['none', 'month', 'practitioner', 'clinic'],
    needs: ['appts'],
    value: (data, ctx) => {
      const before = new Set<string>()
      const seen = new Set<string>()
      for (const a of filteredAppts(data, ctx)) {
        if (a.status !== 'completed') continue
        if (a.at < ctx.from.getTime()) before.add(a.patient_id)
        else if (a.at <= ctx.to.getTime()) seen.add(a.patient_id)
      }
      if (seen.size === 0) return null
      return Math.round(([...seen].filter((id) => before.has(id)).length / seen.size) * 100)
    },
  },
  {
    key: 'patient_funnel',
    area: 'patients',
    label: ['Care funnel after a first visit', 'Embudo tras la primera visita'],
    description: ['New patients in the period, and how many went on to each later stage', 'Pacientes nuevos del periodo, y cuántos llegaron a cada etapa siguiente'],
    unit: 'count',
    splits: ['none'],
    needs: ['appts'],
    steps: (data, ctx) => {
      const completed = filteredAppts(data, ctx).filter((a) => a.status === 'completed')
      const index = byPatientStage(completed)
      const cohort: { patient: string; at: number }[] = []
      const seen = new Set<string>()
      for (const a of [...completed].sort((x, y) => x.at - y.at)) {
        if ((a.stage === 'first_visit' || a.stage === 'first_visit_offer') && inRange(a.at, ctx) && !seen.has(a.patient_id)) {
          seen.add(a.patient_id)
          cohort.push({ patient: a.patient_id, at: a.at })
        }
      }
      const later = (stage: string) => cohort.filter((c) => index.get(c.patient)?.get(stage)?.some((a) => a.at > c.at)).length
      return [
        { label: ctx.t('First visit', 'Primera visita'), value: cohort.length },
        { label: ctx.t('Report', 'Informe'), value: later('report') },
        { label: ctx.t('Adjustment', 'Ajuste'), value: later('adjustment') },
        { label: ctx.t('Revision', 'Revisión'), value: later('revision') },
        { label: ctx.t('Maintenance', 'Mantenimiento'), value: later('maintenance') },
      ]
    },
  },
  {
    key: 'recalls_due',
    area: 'patients',
    label: ['Recalls due', 'Seguimientos pendientes'],
    description: ['Patients due a recall with nothing booked (as on Recalls)', 'Pacientes pendientes de seguimiento sin cita (como en Seguimientos)'],
    unit: 'count',
    splits: ['none', 'practitioner', 'clinic'],
    needs: ['recalls'],
    snapshot: true,
    records: (data, ctx) =>
      data.recalls
        .filter((r) => (!ctx.practitionerId || r.default_practitioner_id === ctx.practitionerId) && (!ctx.clinicId || r.clinic_id === ctx.clinicId))
        .map((r) => ({ dims: { practitioner: r.default_practitioner_id ?? '', clinic: r.clinic_id ?? '' }, v: 1 })),
  },
  {
    key: 'care_plans_behind',
    area: 'patients',
    label: ['Care plans behind schedule', 'Planes de cuidado con retraso'],
    description: ['Care plans past their next due visit with nothing booked', 'Planes de cuidado con la siguiente visita vencida y sin cita'],
    unit: 'count',
    splits: ['none', 'practitioner'],
    needs: ['carePlans'],
    snapshot: true,
    records: (data, ctx) =>
      data.carePlans
        .filter((r) => !ctx.practitionerId || r.default_practitioner_id === ctx.practitionerId)
        .map((r) => ({ dims: { practitioner: r.default_practitioner_id ?? '' }, v: 1 })),
  },

  // --- Money -----------------------------------------------------------------
  {
    key: 'income_paid',
    area: 'money',
    label: ['Income paid', 'Ingresos cobrados'],
    description: ['Money received. Refunds are netted; credit and write-offs are not money and are left out', 'Dinero cobrado. Los reembolsos se descuentan; el crédito y las bajas no son dinero y no cuentan'],
    unit: 'eur',
    splits: ['none', ...TIME, 'weekday', 'practitioner', 'clinic', 'method', 'service'],
    needs: ['money'],
    records: (data, ctx, split) => {
      const { m, apptOf, payments } = filteredPayments(data, ctx)
      if (split === 'service') {
        // Income's "By service": the full lines of every invoice the period's
        // payments settle -- credit included, since a session paid from a
        // bono is still a session -- not the payments themselves.
        const settled = new Set(payments.map((p) => p.invoice_id))
        return m.lines.filter((li) => settled.has(li.invoice_id)).map((li) => ({ dims: { service: lineService(data, m, li) }, v: li.price_cents * li.quantity }))
      }
      return payments.filter((p) => isReceipt(p.method)).map((p) => ({ at: p.at, dims: moneyDims(m, apptOf(p.invoice_id), p.patient_id, p.method), v: p.amount_cents }))
    },
  },
  {
    key: 'payments_count',
    area: 'money',
    label: ['Payments received', 'Cobros recibidos'],
    description: ['How many payments came in (credit and write-offs left out)', 'Cuántos cobros entraron (sin crédito ni bajas)'],
    unit: 'count',
    splits: ['none', ...TIME, 'weekday', 'practitioner', 'clinic', 'method'],
    needs: ['money'],
    records: (data, ctx) => {
      const { m, apptOf, payments } = filteredPayments(data, ctx)
      return payments.filter((p) => isReceipt(p.method)).map((p) => ({ at: p.at, dims: moneyDims(m, apptOf(p.invoice_id), p.patient_id, p.method), v: 1 }))
    },
  },
  {
    key: 'total_charged',
    area: 'money',
    label: ['Total charged', 'Total facturado'],
    description: ['Invoiced in the period, paid or not (void invoices left out)', 'Facturado en el periodo, cobrado o no (sin las anuladas)'],
    unit: 'eur',
    splits: ['none', ...TIME, 'practitioner', 'clinic'],
    needs: ['money'],
    records: (data, ctx) => {
      const m = data.money(ctx.from, ctx.to)
      return m.invoices.filter((i) => moneyClassify(m, ctx, i.appointment_id, i.patient_id) === 'matches').map((i) => ({ at: i.at, dims: moneyDims(m, i.appointment_id, i.patient_id), v: i.total_cents }))
    },
  },
  {
    key: 'outstanding',
    area: 'money',
    label: ['Outstanding', 'Pendiente de cobro'],
    description: ['Of what was invoiced in the period, what has not been paid yet', 'De lo facturado en el periodo, lo que aún no se ha cobrado'],
    unit: 'eur',
    splits: ['none', ...TIME, 'practitioner', 'clinic'],
    needs: ['money'],
    records: (data, ctx) => {
      const m = data.money(ctx.from, ctx.to)
      return m.invoices
        .filter((i) => i.status !== 'paid' && moneyClassify(m, ctx, i.appointment_id, i.patient_id) === 'matches')
        .map((i) => ({ at: i.at, dims: moneyDims(m, i.appointment_id, i.patient_id), v: Math.max(0, i.total_cents - (m.paidByInvoice.get(i.id) ?? 0)) }))
    },
  },
  {
    key: 'income_per_visit',
    area: 'money',
    label: ['Average income per visit', 'Ingreso medio por visita'],
    description: ['Income paid ÷ completed visits (the dashboard called this PVA)', 'Ingresos cobrados ÷ visitas completadas (el panel lo llamaba PVA)'],
    unit: 'eur',
    splits: ['none', 'month', 'practitioner', 'clinic'],
    needs: ['money', 'appts'],
    value: (data, ctx) => {
      const visits = filteredAppts(data, ctx).filter((a) => a.status === 'completed' && inRange(a.at, ctx)).length
      if (visits === 0) return null
      const paid = filteredPayments(data, ctx).payments.filter((p) => isReceipt(p.method)).reduce((s, p) => s + p.amount_cents, 0)
      return Math.round(paid / visits)
    },
  },
  {
    key: 'refunds',
    area: 'money',
    label: ['Refunds', 'Reembolsos'],
    description: ['Money given back', 'Dinero devuelto'],
    unit: 'eur',
    splits: ['none', ...TIME, 'practitioner', 'clinic', 'method'],
    needs: ['money'],
    records: (data, ctx) => {
      const { m, apptOf, payments } = filteredPayments(data, ctx)
      return payments.filter((p) => isReceipt(p.method) && p.amount_cents < 0).map((p) => ({ at: p.at, dims: moneyDims(m, apptOf(p.invoice_id), p.patient_id, p.method), v: -p.amount_cents }))
    },
  },
  {
    key: 'credit_applied',
    area: 'money',
    label: ['Credit applied', 'Crédito aplicado'],
    description: ['Patient credit spent. Not new money: it was income when it was paid in', 'Crédito del paciente gastado. No es dinero nuevo: contó como ingreso cuando se pagó'],
    unit: 'eur',
    splits: ['none', ...TIME, 'practitioner', 'clinic'],
    needs: ['money'],
    records: (data, ctx) => {
      const { m, apptOf, payments } = filteredPayments(data, ctx)
      return payments.filter((p) => p.method === 'credit').map((p) => ({ at: p.at, dims: moneyDims(m, apptOf(p.invoice_id), p.patient_id), v: p.amount_cents }))
    },
  },

  // --- Packages & memberships --------------------------------------------------
  {
    key: 'bonos_sold',
    area: 'packages',
    label: ['Bonos sold', 'Bonos vendidos'],
    description: ['Bono purchases in the period', 'Compras de bonos en el periodo'],
    unit: 'count',
    splits: ['none', ...TIME, 'package'],
    needs: ['bonos'],
    clinicWide: true,
    permission: 'billing',
    records: (data, ctx) =>
      data.bonos.purchases.filter((p) => inRange(Date.parse(p.purchased_at), ctx)).map((p) => ({ at: Date.parse(p.purchased_at), dims: { package: `name:${p.package_name}` }, v: 1 })),
  },
  {
    key: 'bono_sales_value',
    area: 'packages',
    label: ['Bono sales (€)', 'Ventas de bonos (€)'],
    description: ['The price of the bonos sold in the period', 'El precio de los bonos vendidos en el periodo'],
    unit: 'eur',
    splits: ['none', ...TIME, 'package'],
    needs: ['bonos'],
    clinicWide: true,
    permission: 'billing',
    records: (data, ctx) =>
      data.bonos.purchases.filter((p) => inRange(Date.parse(p.purchased_at), ctx)).map((p) => ({ at: Date.parse(p.purchased_at), dims: { package: `name:${p.package_name}` }, v: p.price_cents })),
  },
  {
    key: 'bono_debt',
    area: 'packages',
    label: ['Bono debt', 'Deuda de bonos'],
    description: ['Owed on bonos, as Debtors counts it', 'Pendiente en bonos, como lo cuenta Deudores'],
    unit: 'eur',
    splits: ['none', 'package'],
    needs: ['bonos'],
    snapshot: true,
    clinicWide: true,
    permission: 'billing',
    records: (data) => {
      const b = data.bonos
      const out: Rec[] = []
      for (const p of b.purchases) {
        const owed = bonoOwedCents({
          purchaseId: p.id,
          invoiceId: p.invoice_id,
          priceCents: p.price_cents,
          owedCents: p.owed_cents,
          invoice: p.invoice_id ? (b.invoicesById.get(p.invoice_id) ?? null) : null,
          payments: b.payments,
        })
        const schedule = b.schedulesByPurchase.get(p.id)
        const debtor = schedule ? schedule.status === 'past_due' && owed > 0 : owed > 0
        if (debtor) out.push({ dims: { package: `name:${p.package_name}` }, v: owed })
      }
      return out
    },
  },
  {
    key: 'bono_sessions_left',
    area: 'packages',
    label: ['Sessions left on bonos', 'Sesiones pendientes en bonos'],
    description: ['Unused sessions across open bonos', 'Sesiones sin usar en los bonos abiertos'],
    unit: 'count',
    splits: ['none', 'package'],
    needs: ['bonos'],
    snapshot: true,
    clinicWide: true,
    permission: 'billing',
    records: (data) =>
      data.bonos.purchases
        .filter((p) => !p.is_closed && p.sessions_used < p.sessions_total)
        .map((p) => ({ dims: { package: `name:${p.package_name}` }, v: Math.max(0, p.sessions_total - p.sessions_used) })),
  },
  {
    key: 'active_memberships',
    area: 'packages',
    label: ['Active memberships', 'Membresías activas'],
    description: ['Memberships currently active', 'Membresías activas ahora'],
    unit: 'count',
    splits: ['none', 'plan'],
    needs: ['memberships'],
    snapshot: true,
    clinicWide: true,
    permission: 'billing',
    records: (data) => data.memberships.filter((m) => m.status === 'active').map((m) => ({ dims: { plan: `name:${m.membership_name}` }, v: 1 })),
  },
  {
    key: 'membership_income',
    area: 'packages',
    label: ['Membership income', 'Ingresos por membresías'],
    description: ['Membership payments received, by the period they pay for', 'Cuotas de membresía cobradas, por el periodo que pagan'],
    unit: 'eur',
    splits: ['none', 'month', 'plan'],
    needs: ['memberships'],
    clinicWide: true,
    permission: 'billing',
    records: (data, ctx) =>
      data.memberships.flatMap((m) =>
        m.payments
          .filter((p) => p.status === 'paid' && inRange(new Date(`${p.period_start}T12:00:00`).getTime(), ctx))
          .map((p) => ({ at: new Date(`${p.period_start}T12:00:00`).getTime(), dims: { plan: `name:${m.membership_name}` }, v: p.amount_cents })),
      ),
  },
  {
    key: 'membership_failed_payments',
    area: 'packages',
    label: ['Failed membership payments', 'Pagos de membresía fallidos'],
    description: ['Membership charges that failed, for periods in the report', 'Cobros de membresía que fallaron, de periodos del informe'],
    unit: 'count',
    splits: ['none', 'month', 'plan'],
    needs: ['memberships'],
    clinicWide: true,
    permission: 'billing',
    records: (data, ctx) =>
      data.memberships.flatMap((m) =>
        m.payments
          .filter((p) => p.status === 'failed' && inRange(new Date(`${p.period_start}T12:00:00`).getTime(), ctx))
          .map((p) => ({ at: new Date(`${p.period_start}T12:00:00`).getTime(), dims: { plan: `name:${m.membership_name}` }, v: 1 })),
      ),
  },

  // --- Messages ----------------------------------------------------------------
  {
    key: 'whatsapp_messages',
    area: 'messages',
    label: ['WhatsApp messages sent', 'Mensajes de WhatsApp enviados'],
    description: ['Messages sent by the clinic, by where they got to: sent, delivered, read or failed', 'Mensajes enviados por la clínica, según hasta dónde llegaron: enviado, entregado, leído o fallido'],
    unit: 'count',
    splits: ['none', ...TIME, 'status', 'kind'],
    needs: ['whatsapp'],
    clinicWide: true,
    permission: 'inbox',
    records: (data, ctx) =>
      data
        .whatsapp(ctx.from, ctx.to)
        .filter((m) => ['sent', 'delivered', 'read', 'failed'].includes(m.status))
        .map((m) => ({ at: m.at, dims: { status: m.status, kind: m.purpose ?? 'other' }, v: 1 })),
  },
  {
    key: 'confirmation_replies',
    area: 'messages',
    label: ['Confirmation replies', 'Respuestas de confirmación'],
    description: ['Upcoming visits asked to confirm: confirmed, pending, or wants to reschedule', 'Próximas citas a las que se pidió confirmar: confirmadas, pendientes o quieren cambiar'],
    unit: 'count',
    splits: ['none', 'status', 'practitioner', 'clinic'],
    needs: ['appts'],
    snapshot: true,
    records: (data, ctx) =>
      filteredAppts(data, ctx)
        .filter((a) => a.status === 'booked' && a.at >= ctx.now.getTime() && a.confirmation_status)
        .map((a) => ({ dims: { ...apptDims(a), status: a.confirmation_status! }, v: 1 })),
  },

  // --- Growth ------------------------------------------------------------------
  {
    key: 'new_leads',
    area: 'growth',
    label: ['New leads', 'Leads nuevos'],
    description: ['Leads created in the period', 'Leads creados en el periodo'],
    unit: 'count',
    splits: ['none', ...TIME, 'channel', 'stage'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    records: (data, ctx) => data.leads(ctx.from, ctx.to).leads.map((l) => ({ at: l.at, dims: { channel: leadChannel(l.source), stage: `lead:${l.stage}` }, v: 1 })),
  },
  {
    key: 'lead_funnel',
    area: 'growth',
    label: ['Lead funnel', 'Embudo de leads'],
    description: ['Leads of the period by the furthest stage they reached', 'Leads del periodo según la etapa más avanzada a la que llegaron'],
    unit: 'count',
    splits: ['none'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    steps: (data, ctx) => {
      const { leads } = data.leads(ctx.from, ctx.to)
      const titles: Record<string, [string, string]> = {
        new: ['New lead', 'Lead nuevo'],
        contacted: ['Contacted', 'Contactado'],
        qualified: ['Qualified', 'Cualificado'],
        booked: ['Booked', 'Reservado'],
        showed: ['Showed', 'Asistió'],
        converted: ['Converted', 'Convertido'],
      }
      return LEAD_FUNNEL.map((stage) => ({ label: ctx.t(...titles[stage]!), value: leads.filter((l) => leadRank(l.furthest_stage) >= leadRank(stage)).length }))
    },
  },
  {
    key: 'lead_conversion',
    area: 'growth',
    label: ['Lead conversion', 'Conversión de leads'],
    description: ['Leads of the period that became patients', 'Leads del periodo que acabaron siendo pacientes'],
    unit: 'pct',
    splits: ['none', ...TIME, 'channel'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    reduce: 'rate',
    records: (data, ctx) => data.leads(ctx.from, ctx.to).leads.map((l) => ({ at: l.at, dims: { channel: leadChannel(l.source) }, v: l.furthest_stage === 'converted' ? 1 : 0, d: 1 })),
  },
  {
    key: 'ad_spend',
    area: 'growth',
    label: ['Ad spend', 'Inversión en anuncios'],
    description: ['What the clinic recorded spending, by month (Growth › spend)', 'Lo que la clínica registró como gasto, por mes (Crecimiento › inversión)'],
    unit: 'eur',
    splits: ['none', 'month', 'channel'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    records: (data, ctx) =>
      spendIn(data.leads(ctx.from, ctx.to).spend, ctx).map((s) => ({ at: new Date(`${s.period_month}T12:00:00`).getTime(), dims: { channel: s.channel }, v: s.amount_cents })),
  },
  {
    key: 'cost_per_lead',
    area: 'growth',
    label: ['Cost per lead', 'Coste por lead'],
    description: ['Ad spend ÷ new leads. Blank when no spend is recorded', 'Inversión ÷ leads nuevos. En blanco si no hay inversión registrada'],
    unit: 'eur',
    splits: ['none', 'month'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    value: (data, ctx) => {
      const { leads, spend } = data.leads(ctx.from, ctx.to)
      const total = spendIn(spend, ctx).reduce((s, r) => s + r.amount_cents, 0)
      return total > 0 && leads.length > 0 ? Math.round(total / leads.length) : null
    },
  },
  {
    key: 'cost_per_new_patient',
    area: 'growth',
    label: ['Cost per new patient', 'Coste por paciente nuevo'],
    description: ['Ad spend ÷ leads converted', 'Inversión ÷ leads convertidos'],
    unit: 'eur',
    splits: ['none', 'month'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    value: (data, ctx) => {
      const { leads, spend } = data.leads(ctx.from, ctx.to)
      const total = spendIn(spend, ctx).reduce((s, r) => s + r.amount_cents, 0)
      const converted = leads.filter((l) => l.furthest_stage === 'converted').length
      return total > 0 && converted > 0 ? Math.round(total / converted) : null
    },
  },
  {
    key: 'revenue_attributed',
    area: 'growth',
    label: ['Revenue attributed', 'Ingresos atribuidos'],
    description: ['Estimated value of the leads converted', 'Valor estimado de los leads convertidos'],
    unit: 'eur',
    splits: ['none', ...TIME, 'channel'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    records: (data, ctx) => {
      const { leads, defaultValueCents } = data.leads(ctx.from, ctx.to)
      return leads.filter((l) => l.furthest_stage === 'converted').map((l) => ({ at: l.at, dims: { channel: leadChannel(l.source) }, v: l.estimated_value_cents ?? defaultValueCents ?? 0 }))
    },
  },
  {
    key: 'roas',
    area: 'growth',
    label: ['ROAS', 'ROAS'],
    description: ['Revenue attributed ÷ ad spend', 'Ingresos atribuidos ÷ inversión'],
    unit: 'times',
    splits: ['none', 'month'],
    needs: ['leads'],
    clinicWide: true,
    permission: 'growth',
    value: (data, ctx) => {
      const { leads, spend, defaultValueCents } = data.leads(ctx.from, ctx.to)
      const total = spendIn(spend, ctx).reduce((s, r) => s + r.amount_cents, 0)
      if (total <= 0) return null
      const revenue = leads.filter((l) => l.furthest_stage === 'converted').reduce((s, l) => s + (l.estimated_value_cents ?? defaultValueCents ?? 0), 0)
      return revenue / total
    },
  },
]

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]))

export const AREAS: { key: Area; label: [string, string] }[] = [
  { key: 'visits', label: ['Visits', 'Visitas'] },
  { key: 'patients', label: ['Patients', 'Pacientes'] },
  { key: 'money', label: ['Money', 'Dinero'] },
  { key: 'packages', label: ['Packages', 'Bonos y membresías'] },
  { key: 'messages', label: ['Messages', 'Mensajes'] },
  { key: 'growth', label: ['Growth', 'Crecimiento'] },
]

export const SPLIT_LABELS: Record<SplitKey, [string, string]> = {
  none: ['Nothing', 'Nada'],
  month: ['Month', 'Mes'],
  week: ['Week', 'Semana'],
  day: ['Day', 'Día'],
  weekday: ['Day of week', 'Día de la semana'],
  hour: ['Hour of day', 'Hora del día'],
  shift: ['Shift', 'Turno'],
  practitioner: ['Practitioner', 'Profesional'],
  clinic: ['Clinic', 'Clínica'],
  appointment_type: ['Appointment type', 'Tipo de cita'],
  stage: ['Stage', 'Etapa'],
  status: ['Status', 'Estado'],
  booked_via: ['Booked via', 'Reservada por'],
  notice: ['Notice', 'Antelación'],
  method: ['Payment method', 'Método de pago'],
  service: ['Service', 'Servicio'],
  referral_source: ['Referral source', 'Origen'],
  package: ['Bono', 'Bono'],
  plan: ['Plan', 'Plan'],
  kind: ['Kind', 'Tipo'],
  channel: ['Channel', 'Canal'],
}

/** Splits that run along time, drawn in order with every bucket present. */
export const TIME_SPLITS: SplitKey[] = ['month', 'week', 'day', 'weekday', 'hour', 'shift']

// ---- Computing ----------------------------------------------------------------

export interface MetricRow {
  key: string
  label: string
  value: number | null
}
export interface MetricResult {
  value: number | null
  rows: MetricRow[]
  steps?: { label: string; value: number }[]
}

function startOfWeek(at: number) {
  const d = new Date(at)
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Every bucket of a time split in the period, in order: [key, label, from, to]. */
function timeBuckets(split: SplitKey, ctx: Ctx): { key: string; label: string; from: Date; to: Date }[] {
  const out: { key: string; label: string; from: Date; to: Date }[] = []
  const end = ctx.to.getTime()
  if (split === 'month') {
    const c = new Date(ctx.from.getFullYear(), ctx.from.getMonth(), 1)
    while (c.getTime() <= end) {
      const next = new Date(c.getFullYear(), c.getMonth() + 1, 1)
      out.push({ key: monthKeyOf(c), label: c.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), from: new Date(Math.max(c.getTime(), ctx.from.getTime())), to: new Date(Math.min(next.getTime() - 1, end)) })
      c.setMonth(c.getMonth() + 1)
    }
  } else if (split === 'week') {
    const c = startOfWeek(ctx.from.getTime())
    while (c.getTime() <= end) {
      const next = new Date(c)
      next.setDate(next.getDate() + 7)
      out.push({ key: isoDay(c), label: c.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), from: new Date(Math.max(c.getTime(), ctx.from.getTime())), to: new Date(Math.min(next.getTime() - 1, end)) })
      c.setDate(c.getDate() + 7)
    }
  } else if (split === 'day') {
    const c = new Date(ctx.from.getFullYear(), ctx.from.getMonth(), ctx.from.getDate())
    while (c.getTime() <= end && out.length < 400) {
      const next = new Date(c)
      next.setDate(next.getDate() + 1)
      out.push({ key: isoDay(c), label: c.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), from: new Date(c), to: new Date(next.getTime() - 1) })
      c.setDate(c.getDate() + 1)
    }
  }
  return out
}

function fixedBuckets(split: SplitKey, t: Ctx['t']): { key: string; label: string }[] {
  if (split === 'weekday') {
    const names: [string, string][] = [['Mon', 'lun'], ['Tue', 'mar'], ['Wed', 'mié'], ['Thu', 'jue'], ['Fri', 'vie'], ['Sat', 'sáb'], ['Sun', 'dom']]
    return names.map(([en, es], i) => ({ key: String(i), label: t(en, es) }))
  }
  if (split === 'hour') return Array.from({ length: 12 }, (_, i) => ({ key: String(i + 8), label: `${String(i + 8).padStart(2, '0')}:00` }))
  if (split === 'shift') {
    return [
      { key: 'morning', label: t('Morning (before 12pm)', 'Mañana (antes de las 12h)') },
      { key: 'afternoon', label: t('Afternoon (12–4pm)', 'Tarde (12–16h)') },
      { key: 'evening', label: t('Evening (4pm+)', 'Noche (a partir de las 16h)') },
    ]
  }
  return []
}

function recKey(r: Rec, split: SplitKey): string | null {
  if (split === 'month') return r.at === undefined ? null : monthKeyOf(new Date(r.at))
  if (split === 'week') return r.at === undefined ? null : isoDay(startOfWeek(r.at))
  if (split === 'day') return r.at === undefined ? null : isoDay(new Date(r.at))
  if (split === 'weekday') {
    if (r.at === undefined) return null
    const d = new Date(r.at).getDay()
    return String(d === 0 ? 6 : d - 1)
  }
  if (split === 'hour') {
    if (r.at === undefined) return null
    const h = new Date(r.at).getHours()
    return h >= 8 && h < 20 ? String(h) : null
  }
  if (split === 'shift') return r.at === undefined ? null : shiftOf(new Date(r.at).getHours())
  return r.dims[split] ?? ''
}

function reduceRecs(recs: Rec[], how: MetricDef['reduce']): number | null {
  if (how === 'distinct') return new Set(recs.map((r) => r.p)).size
  if (how === 'rate') {
    const d = recs.reduce((s, r) => s + (r.d ?? 0), 0)
    return d === 0 ? null : Math.round((recs.reduce((s, r) => s + r.v, 0) / d) * 100)
  }
  return recs.reduce((s, r) => s + r.v, 0)
}

export function labelFor(split: SplitKey, key: string, names: Names, t: Ctx['t']): string {
  const unassigned = t('Unassigned', 'Sin asignar')
  if (split === 'practitioner') return key ? (names.member.get(key) ?? t('Unknown', 'Desconocido')) : unassigned
  if (split === 'clinic') return key ? (names.clinic.get(key) ?? t('Unknown', 'Desconocido')) : t('No clinic', 'Sin clínica')
  if (split === 'appointment_type') return key ? (names.type.get(key) ?? t('Unknown', 'Desconocido')) : t('No type', 'Sin tipo')
  if (split === 'method') return names.method(key)
  if (split === 'referral_source') return key || t('Not recorded', 'Sin indicar')
  if (split === 'booked_via') return ({ staff: t('Staff', 'Recepción'), online: t('Online', 'Online'), api: 'API' } as Record<string, string>)[key] ?? key
  if (split === 'stage') {
    if (key.startsWith('lead:')) return key.slice(5)
    const stages: Record<string, [string, string]> = {
      first_visit: ['First visit', 'Primera visita'],
      first_visit_offer: ['First visit (offer)', 'Primera visita con oferta'],
      report: ['Report', 'Informe'],
      revision: ['Revision', 'Revisión'],
      maintenance: ['Maintenance', 'Mantenimiento'],
      adjustment: ['Adjustment', 'Ajuste'],
      other: ['Other', 'Otro'],
    }
    return stages[key] ? t(...stages[key]!) : t('No stage', 'Sin etapa')
  }
  if (split === 'status') {
    const statuses: Record<string, [string, string]> = {
      booked: ['Booked', 'Reservada'],
      completed: ['Completed', 'Completada'],
      cancelled: ['Cancelled', 'Cancelada'],
      no_show: ['No-show', 'No presentado'],
      sent: ['Sent', 'Enviado'],
      delivered: ['Delivered', 'Entregado'],
      read: ['Read', 'Leído'],
      failed: ['Failed', 'Fallido'],
      confirmed: ['Confirmed', 'Confirmada'],
      pending: ['Pending', 'Pendiente'],
      reschedule_requested: ['Wants to reschedule', 'Quiere reprogramar'],
      active: ['Active', 'Activo'],
      snoozed: ['Snoozed', 'Pospuesto'],
      dismissed: ['Dismissed', 'Descartado'],
    }
    return statuses[key] ? t(...statuses[key]!) : key || t('None', 'Ninguno')
  }
  if (split === 'kind') {
    const kinds: Record<string, [string, string]> = { confirmation: ['Confirmation', 'Confirmación'], reminder: ['Reminder', 'Recordatorio'], recall: ['Recall', 'Seguimiento'], other: ['Other', 'Otro'] }
    return kinds[key] ? t(...kinds[key]!) : key
  }
  if (split === 'service' || split === 'package' || split === 'plan') {
    if (key.startsWith('service:')) return names.service.get(key.slice(8)) ?? t('Unknown service', 'Servicio desconocido')
    if (key.startsWith('package:')) return names.package.get(key.slice(8)) ?? t('Unknown', 'Desconocido')
    if (key.startsWith('type:')) return names.type.get(key.slice(5)) ?? t('Unknown', 'Desconocido')
    if (key.startsWith('name:')) return key.slice(5)
    return t('Not identified', 'Sin identificar')
  }
  return key
}

/** The metric for the period, and split as asked. */
export function computeMetric(def: MetricDef, split: SplitKey, data: ReportData, ctx: Ctx): MetricResult {
  if (def.steps) {
    const steps = def.steps(data, ctx)
    return { value: steps[0]?.value ?? 0, rows: steps.map((s) => ({ key: s.label, label: s.label, value: s.value })), steps }
  }
  const effectiveSplit = def.splits.includes(split) ? split : 'none'

  if (def.value) {
    const value = def.value(data, ctx)
    if (effectiveSplit === 'none') return { value, rows: [] }
    let rows: MetricRow[]
    if (effectiveSplit === 'month' || effectiveSplit === 'week' || effectiveSplit === 'day') {
      rows = timeBuckets(effectiveSplit, ctx).map((b) => ({ key: b.key, label: b.label, value: def.value!(data, { ...ctx, from: b.from, to: b.to }) }))
    } else {
      // Each practitioner (or clinic) as if the page were filtered to them,
      // which is how the standard reports compute these.
      const ids = new Set<string>()
      const field = effectiveSplit === 'practitioner' ? 'practitioner_id' : 'clinic_id'
      for (const a of filteredAppts(data, ctx)) if (a[field] && inRange(a.at, ctx)) ids.add(a[field]!)
      rows = [...ids]
        .map((id) => ({
          key: id,
          label: labelFor(effectiveSplit, id, data.names, ctx.t),
          value: def.value!(data, { ...ctx, [effectiveSplit === 'practitioner' ? 'practitionerId' : 'clinicId']: id }),
        }))
        .filter((r) => r.value !== null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    }
    return { value, rows }
  }

  const recs = def.records!(data, ctx, effectiveSplit)
  // A total "by service" is the sum of what the lines say, which is Income's
  // by-service chart; the metric's own total is always the one without it.
  const total = effectiveSplit === 'service' ? reduceRecs(def.records!(data, ctx, 'none'), def.reduce) : reduceRecs(recs, def.reduce)
  if (effectiveSplit === 'none') return { value: total, rows: [] }

  const groups = new Map<string, Rec[]>()
  for (const r of recs) {
    const k = recKey(r, effectiveSplit)
    if (k === null) continue
    const list = groups.get(k)
    if (list) list.push(r)
    else groups.set(k, [r])
  }
  const empty = def.reduce === 'rate' ? null : 0
  let rows: MetricRow[]
  if (effectiveSplit === 'month' || effectiveSplit === 'week' || effectiveSplit === 'day') {
    rows = timeBuckets(effectiveSplit, ctx).map((b) => ({ key: b.key, label: b.label, value: groups.has(b.key) ? reduceRecs(groups.get(b.key)!, def.reduce) : empty }))
  } else if (TIME_SPLITS.includes(effectiveSplit)) {
    rows = fixedBuckets(effectiveSplit, ctx.t).map((b) => ({ key: b.key, label: b.label, value: groups.has(b.key) ? reduceRecs(groups.get(b.key)!, def.reduce) : empty }))
  } else {
    rows = [...groups.entries()]
      .map(([key, list]) => ({ key, label: labelFor(effectiveSplit, key, data.names, ctx.t), value: reduceRecs(list, def.reduce) }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.label.localeCompare(b.label))
  }
  return { value: total, rows }
}

// ---- Periods ------------------------------------------------------------------

function clampShift(d: Date, months: number) {
  const shifted = new Date(d)
  shifted.setMonth(shifted.getMonth() + months)
  if (shifted.getDate() !== d.getDate()) shifted.setDate(0)
  return shifted
}

/**
 * The period to compare with. "Previous period" is the same dates in the
 * month(s) before when the period is whole months, as Statistics compares
 * (1–15 Sep with 1–15 Aug); otherwise the same number of days just before.
 */
export function comparisonRange(from: Date, to: Date, compare: 'none' | 'previous_period' | 'previous_year'): { from: Date; to: Date } | null {
  if (compare === 'none') return null
  if (compare === 'previous_year') return { from: clampShift(from, -12), to: clampShift(to, -12) }
  if (from.getDate() === 1) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
    return { from: clampShift(from, -months), to: clampShift(to, -months) }
  }
  const length = to.getTime() - from.getTime()
  const end = new Date(from.getTime() - 1)
  return { from: new Date(end.getTime() - length), to: end }
}

// ---- Formatting ---------------------------------------------------------------

const LOCALE = 'es-ES'
export function formatMetric(value: number | null, unit: Unit): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (unit === 'eur') return (value / 100).toLocaleString(LOCALE, { style: 'currency', currency: 'EUR' })
  if (unit === 'pct') return `${Math.round(value)}%`
  if (unit === 'decimal') return value.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (unit === 'times') return `${value.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
  return Math.round(value).toLocaleString(LOCALE)
}

/** The change against the comparison, worded for its unit: percentage points for a rate. */
export function formatDelta(current: number | null, previous: number | null, unit: Unit): { text: string; up: boolean } | null {
  if (current === null || previous === null) return null
  if (unit === 'pct') {
    const diff = Math.round(current - previous)
    return { text: `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} pts`, up: diff >= 0 }
  }
  if (unit === 'decimal' || unit === 'times') {
    const diff = current - previous
    return { text: `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toLocaleString(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`, up: diff >= 0 }
  }
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0 }
}
