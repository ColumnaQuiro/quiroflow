// The shape of a report page (table report_pages) and of the blocks on it.
// What each metric means and how it is computed is utils/reportMetrics.ts;
// this file is only what a page stores and offers.

export type ChartKind = 'number' | 'bar' | 'line' | 'donut' | 'table' | 'funnel'

export type SplitKey =
  | 'none'
  | 'month'
  | 'week'
  | 'day'
  | 'weekday'
  | 'hour'
  | 'shift'
  | 'practitioner'
  | 'clinic'
  | 'appointment_type'
  | 'stage'
  | 'status'
  | 'booked_via'
  | 'notice'
  | 'method'
  | 'service'
  | 'referral_source'
  | 'package'
  | 'plan'
  | 'kind'
  | 'channel'

/** A block's own period, when it does not follow the page's. */
export type OwnPeriod = 'last_3_months' | 'last_6_months' | 'last_12_months' | 'this_year' | 'last_year'
export type BlockPeriod = { mode: 'page' } | { mode: 'own'; preset: OwnPeriod }

export interface BlockConfig {
  metric: string
  split: SplitKey
  chart: ChartKind
  /** Narrower than the page, never wider: a block cannot show a practitioner the page's own-only scope hides. */
  filters?: { practitionerId?: string | null; clinicId?: string | null; method?: string | null }
  period?: BlockPeriod
}

export interface ReportBlock {
  id: string
  title: string
  /** Width on the 12-column grid. */
  span: 3 | 4 | 6 | 8 | 12
  config: BlockConfig
  /** Where it came from, shown as a tag: a standard report's name, or 'saved'. */
  origin?: string | null
}

export type PagePeriod = 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'last_3_months' | 'last_12_months' | 'custom'
export type Compare = 'none' | 'previous_period' | 'previous_year'

export interface PageSettings {
  period?: PagePeriod
  from?: string
  to?: string
  compare?: Compare
}

export const SPANS: ReportBlock['span'][] = [3, 4, 6, 8, 12]
export const NEXT_SPAN: Record<ReportBlock['span'], ReportBlock['span']> = { 3: 4, 4: 6, 6: 8, 8: 12, 12: 3 }

/** Tailwind needs the whole class names written out. */
export const SPAN_CLASS: Record<ReportBlock['span'], string> = {
  3: 'col-span-12 sm:col-span-6 lg:col-span-3',
  4: 'col-span-12 sm:col-span-6 lg:col-span-4',
  6: 'col-span-12 lg:col-span-6',
  8: 'col-span-12 lg:col-span-8',
  12: 'col-span-12',
}

export function newBlockId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** A block read from the database, made safe to render whatever an older version stored. */
export function normaliseBlocks(raw: unknown): ReportBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((b): b is Record<string, any> => !!b && typeof b === 'object' && typeof b.config?.metric === 'string')
    .map((b) => ({
      id: typeof b.id === 'string' ? b.id : newBlockId(),
      title: typeof b.title === 'string' ? b.title : '',
      span: SPANS.includes(b.span) ? b.span : 6,
      config: {
        metric: b.config.metric,
        split: typeof b.config.split === 'string' ? b.config.split : 'none',
        chart: typeof b.config.chart === 'string' ? b.config.chart : 'number',
        filters: b.config.filters ?? undefined,
        period: b.config.period?.mode === 'own' ? { mode: 'own', preset: b.config.period.preset } : { mode: 'page' },
      },
      origin: typeof b.origin === 'string' ? b.origin : null,
    }))
}

/**
 * A report saved by the old Custom Reports page ({ source, metric, groupBy,
 * chartType, range }) or by New report ({ v: 2, ...BlockConfig }), as a
 * block config. The old ones are read as they are, not migrated: the page
 * that wrote them is still live until the release that retires it.
 */
export function savedReportConfig(config: unknown): BlockConfig | null {
  const c = (config ?? {}) as Record<string, any>
  if (c.v === 2 && typeof c.metric === 'string') {
    return { metric: c.metric, split: c.split ?? 'none', chart: c.chart ?? 'bar', filters: c.filters ?? undefined, period: c.period ?? { mode: 'page' } }
  }
  const chart: ChartKind = c.chartType === 'line' ? 'line' : c.chartType === 'table' ? 'table' : 'bar'
  const groupBy: Record<string, SplitKey> = {
    month: 'month',
    weekday: 'weekday',
    status: 'status',
    practitioner: 'practitioner',
    appointment_type: 'appointment_type',
    method: 'method',
    recall_status: 'status',
    preferred_language: 'none',
    confirmation_channel: 'none',
  }
  const split = groupBy[c.groupBy] ?? 'none'
  if (c.source === 'appointments') return { metric: 'visits_booked', split, chart }
  if (c.source === 'payments') return { metric: c.metric === 'count' ? 'payments_count' : 'income_paid', split, chart }
  if (c.source === 'patients') return { metric: 'total_patients', split: c.groupBy === 'practitioner' ? 'practitioner' : c.groupBy === 'recall_status' ? 'status' : 'none', chart }
  return null
}

type Preset = Omit<ReportBlock, 'id'>
const b = (title: string, span: ReportBlock['span'], metric: string, split: SplitKey, chart: ChartKind, origin: string | null, period?: BlockPeriod): Preset => ({
  title,
  span,
  config: { metric, split, chart, period: period ?? { mode: 'page' } },
  origin,
})

/**
 * "From reports": the sections of the standard reports, as blocks. Titles are
 * [English, Spanish]; the page stores the one shown when it was added, and
 * the person can rename it.
 */
export function reportLibrary(t: (en: string, es: string) => string): { report: string; blocks: Preset[] }[] {
  const STATS = t('Statistics', 'Estadísticas')
  const INCOME = t('Income & Payments', 'Ingresos y pagos')
  const PERF = t('Income Performance', 'Rendimiento de ingresos')
  const DIST = t('Appointment Distribution', 'Distribución de citas')
  const UPCOMING = t('Upcoming Visits', 'Próximas visitas')
  const DEBT = t('Debtors', 'Deudores')
  const MEMB = t('Memberships', 'Membresías')
  const REMIND = t('Scheduled Reminders', 'Recordatorios programados')
  const GROWTH = t('Growth', 'Crecimiento')
  const DASH = t('Dashboard', 'Panel')
  return [
    {
      report: STATS,
      blocks: [
        b(t('First visits', 'Primeras visitas'), 3, 'first_visits', 'none', 'number', STATS),
        b(t('Completed visits', 'Visitas completadas'), 3, 'visits_completed', 'none', 'number', STATS),
        b(t('PVA (visits per new patient)', 'PVA (visitas por paciente nuevo)'), 3, 'pva', 'none', 'number', STATS),
        b(t('Conversion to 3rd visit', 'Conversión a la 3.ª visita'), 3, 'conversion_third_visit', 'none', 'number', STATS),
        b(t('Retention post-revision', 'Retención tras revisión'), 3, 'retention_post_revision', 'none', 'number', STATS),
        b(t('Overall retention', 'Retención general'), 3, 'overall_retention', 'none', 'number', STATS),
        b(t('Visits by stage', 'Visitas por etapa'), 6, 'visits_completed', 'stage', 'bar', STATS),
        b(t('Month by month', 'Mes a mes'), 12, 'visits_completed', 'month', 'table', STATS),
      ],
    },
    {
      report: INCOME,
      blocks: [
        b(t('Total charged', 'Total facturado'), 3, 'total_charged', 'none', 'number', INCOME),
        b(t('Income paid', 'Ingresos cobrados'), 3, 'income_paid', 'none', 'number', INCOME),
        b(t('Outstanding', 'Pendiente'), 3, 'outstanding', 'none', 'number', INCOME),
        b(t('Income paid by month', 'Ingresos cobrados por mes'), 8, 'income_paid', 'month', 'bar', INCOME, { mode: 'own', preset: 'last_12_months' }),
        b(t('By payment method', 'Por método de pago'), 4, 'income_paid', 'method', 'donut', INCOME),
        b(t('By practitioner', 'Por profesional'), 6, 'income_paid', 'practitioner', 'bar', INCOME),
        b(t('By service', 'Por servicio'), 6, 'income_paid', 'service', 'table', INCOME),
      ],
    },
    {
      report: PERF,
      blocks: [b(t('Practitioners by month', 'Profesionales por mes'), 12, 'income_paid', 'practitioner', 'line', PERF, { mode: 'own', preset: 'last_6_months' })],
    },
    {
      report: DIST,
      blocks: [
        b(t('Visits by shift', 'Visitas por turno'), 6, 'visits_booked', 'shift', 'table', DIST),
        b(t('Show rate by shift', 'Asistencia por turno'), 6, 'show_rate', 'shift', 'table', DIST),
        b(t('Visits by hour of day', 'Visitas por hora del día'), 6, 'visits_booked', 'hour', 'bar', DIST),
      ],
    },
    {
      report: UPCOMING,
      blocks: [
        b(t('Visits by day of week', 'Visitas por día de la semana'), 6, 'visits_booked', 'weekday', 'bar', UPCOMING),
        b(t('Daily average', 'Media diaria'), 3, 'visits_daily_average', 'none', 'number', UPCOMING),
        b(t('Cancelled / no-show', 'Canceladas / no presentadas'), 3, 'cancellations', 'none', 'number', UPCOMING),
      ],
    },
    {
      report: DEBT,
      blocks: [b(t('Bono debt', 'Deuda de bonos'), 3, 'bono_debt', 'none', 'number', DEBT), b(t('Bono debt by package', 'Deuda por bono'), 6, 'bono_debt', 'package', 'table', DEBT)],
    },
    {
      report: MEMB,
      blocks: [
        b(t('Active memberships', 'Membresías activas'), 3, 'active_memberships', 'none', 'number', MEMB),
        b(t('Membership income', 'Ingresos por membresías'), 3, 'membership_income', 'none', 'number', MEMB),
        b(t('Failed membership payments', 'Pagos de membresía fallidos'), 3, 'membership_failed_payments', 'none', 'number', MEMB),
      ],
    },
    {
      report: REMIND,
      blocks: [
        b(t('WhatsApp delivery', 'Entrega de WhatsApp'), 6, 'whatsapp_messages', 'status', 'bar', REMIND),
        b(t('Confirmation replies', 'Respuestas de confirmación'), 6, 'confirmation_replies', 'status', 'donut', REMIND),
      ],
    },
    {
      report: GROWTH,
      blocks: [
        b(t('New leads', 'Leads nuevos'), 3, 'new_leads', 'none', 'number', GROWTH),
        b(t('Lead funnel', 'Embudo de leads'), 12, 'lead_funnel', 'none', 'funnel', GROWTH),
        b(t('Leads by channel', 'Leads por canal'), 6, 'new_leads', 'channel', 'bar', GROWTH),
      ],
    },
    {
      report: DASH,
      blocks: [
        b(t('Active patients', 'Pacientes activos'), 3, 'active_patients', 'none', 'number', DASH),
        b(t('Total patients', 'Pacientes totales'), 3, 'total_patients', 'none', 'number', DASH),
        b(t('No-show rate', 'Tasa de no presentados'), 3, 'no_show_rate', 'none', 'number', DASH),
        b(t('Average income per visit', 'Ingreso medio por visita'), 3, 'income_per_visit', 'none', 'number', DASH),
        b(t('Recalls due', 'Seguimientos pendientes'), 3, 'recalls_due', 'none', 'number', DASH),
      ],
    },
  ]
}

export interface PageTemplate {
  key: string
  name: string
  description: string
  blocks: Preset[]
}

export function pageTemplates(t: (en: string, es: string) => string): PageTemplate[] {
  const lib = reportLibrary(t).flatMap((g) => g.blocks)
  const find = (metric: string, split: SplitKey = 'none') => lib.find((p) => p.config.metric === metric && p.config.split === split)!
  return [
    {
      key: 'monthly',
      name: t('Monthly management', 'Gestión mensual'),
      description: t('Income, visits, new patients and conversion', 'Ingresos, visitas, pacientes nuevos y conversión'),
      blocks: [
        find('income_paid'),
        find('visits_completed'),
        b(t('New patients', 'Pacientes nuevos'), 3, 'new_patients', 'none', 'number', null),
        find('pva'),
        find('income_paid', 'month'),
        find('income_paid', 'method'),
        b(t('Completed visits by practitioner', 'Visitas completadas por profesional'), 6, 'visits_completed', 'practitioner', 'bar', null),
        b(t('New patients by referral source', 'Pacientes nuevos por origen'), 6, 'new_patients', 'referral_source', 'table', null),
        b(t('Conversion after a first visit', 'Conversión tras la primera visita'), 8, 'patient_funnel', 'none', 'funnel', null),
        find('show_rate', 'shift'),
      ],
    },
    {
      key: 'practitioners',
      name: t('Practitioner performance', 'Rendimiento por profesional'),
      description: t('Visits, income and PVA per practitioner', 'Visitas, ingresos y PVA por profesional'),
      blocks: [
        b(t('Income paid by practitioner', 'Ingresos por profesional'), 6, 'income_paid', 'practitioner', 'bar', null),
        b(t('Completed visits by practitioner', 'Visitas completadas por profesional'), 6, 'visits_completed', 'practitioner', 'bar', null),
        b(t('PVA by practitioner', 'PVA por profesional'), 6, 'pva', 'practitioner', 'table', null),
        b(t('Show rate by practitioner', 'Asistencia por profesional'), 6, 'show_rate', 'practitioner', 'table', null),
        find('income_paid', 'practitioner') && b(t('Practitioners by month', 'Profesionales por mes'), 12, 'income_paid', 'practitioner', 'line', null, { mode: 'own', preset: 'last_6_months' }),
      ],
    },
    {
      key: 'growth',
      name: t('Growth & leads', 'Crecimiento y leads'),
      description: t('Leads, the funnel and where new patients come from', 'Leads, el embudo y de dónde vienen los pacientes nuevos'),
      blocks: [
        find('new_leads'),
        b(t('Lead conversion', 'Conversión de leads'), 3, 'lead_conversion', 'none', 'number', null),
        b(t('New patients', 'Pacientes nuevos'), 3, 'new_patients', 'none', 'number', null),
        find('conversion_third_visit'),
        find('lead_funnel'),
        find('new_leads', 'channel'),
        b(t('New patients by referral source', 'Pacientes nuevos por origen'), 6, 'new_patients', 'referral_source', 'bar', null),
      ],
    },
  ]
}
