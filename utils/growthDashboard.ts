// The dashboard as the components draw it: every figure already worded.

export type GrowthTone = 'positive' | 'negative' | 'neutral'

export interface GrowthKpi {
  key: string
  label: string
  value: string
  delta: string
  tone: GrowthTone
}

export interface GrowthFunnelStage {
  key: string
  label: string
  count: number
  caption: string
}

export interface GrowthFunnelStep {
  pct: number
  delta: string
  tone: 'neutral' | 'warning' | 'danger'
  emphasis?: boolean
}

export interface GrowthChannelRow {
  /** The key spend is recorded under; empty on the totals row. */
  channel: string
  /** What the row is called on screen ("Directo" for Direct). */
  label: string
  /** null where the clinic has recorded no spend for this channel. */
  spend: string | null
  /** The same figure unformatted, so it can be edited in place. */
  spendCents: number | null
  leads: number
  booked: number
  /** null while no booked lead has had the chance to turn up yet. */
  showRate: number | null
  costPerNewPatient: string | null
}

export interface GrowthTrendPoint {
  label: string
  leads: number
  booked: number
}

export interface GrowthAlert {
  key: string
  tone: Exclude<GrowthTone, 'positive'>
  title: string
  detail: string
}

export interface GrowthAiSummary {
  conversations: number
  booked: number
  bookRate: string
  avgReply: string
  escalated: number
}

export interface GrowthDashboardData {
  periodLabel: string
  kpis: GrowthKpi[]
  funnelStages: GrowthFunnelStage[]
  funnelSteps: GrowthFunnelStep[]
  endToEndRate: string
  dropOff: { summary: string; action: string } | null
  ai: GrowthAiSummary | null
  alerts: GrowthAlert[]
  channels: GrowthChannelRow[]
  channelTotals: GrowthChannelRow
  trend: GrowthTrendPoint[]
  trendAxis: string[]
}

// What /api/growth/dashboard sends: numbers, keys and dates, no prose.
//
// It used to send finished English sentences -- KPI labels, alert titles,
// stage names, "All channels", "October 2026" -- which a Spanish-speaking
// front desk then read in the middle of an otherwise Spanish screen. The
// words are chosen here, in the browser, where the staff member's language
// is known; the server only says what the figures are.

export interface GrowthChannelPayload {
  /** Source prefix ("Meta Ads"), or "Direct" for a lead with no source. */
  channel: string
  /** null where the clinic has recorded no spend for this channel. */
  spendCents: number | null
  leads: number
  booked: number
  /** null while no booked lead has had the chance to turn up yet. */
  showRate: number | null
  costPerNewPatientCents: number | null
}

export type GrowthAlertPayload =
  | { key: 'stale'; count: number; neverContacted: number }
  | { key: 'no-spend' }
  | { key: 'pending-replies'; count: number }
  | { key: 'unattributed'; count: number }

export interface GrowthDashboardPayload {
  /** The month the figures cover, "2026-10", in the clinic's own time zone. */
  month: string
  newLeads: number
  leads90d: number
  /** null when nothing was recorded, which is not the same as zero spent. */
  spendCents: number | null
  converted: number
  revenueCents: number
  funnel: { key: string; count: number }[]
  channels: GrowthChannelPayload[]
  totals: Omit<GrowthChannelPayload, 'channel'>
  /** Oldest first; weekStart is a calendar date, "2026-07-14". */
  trend: { weekStart: string; leads: number; booked: number }[]
  alerts: GrowthAlertPayload[]
  /** No conversations table yet. Null rather than absent: "none", not "failed". */
  ai: null
}

export const GROWTH_DIRECT_CHANNEL = 'Direct'

type T = (en: string, es: string) => string

const STAGE_TITLES: Record<string, [string, string]> = {
  new: ['New Lead', 'Lead nuevo'],
  contacted: ['Contacted', 'Contactado'],
  qualified: ['Qualified', 'Cualificado'],
  booked: ['Booked', 'Reservado'],
  showed: ['Showed', 'Asistió'],
  converted: ['Converted', 'Convertido'],
}

// es-ES whatever the interface language, as the server formatted it before:
// the clinics are in Spain and "1.480 €" is how their money is written.
function euros(cents: number | null) {
  if (cents === null) return null
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** The payload, worded in the staff member's language. */
export function growthDashboardView(p: GrowthDashboardPayload, t: T, lang: 'en' | 'es'): GrowthDashboardData {
  const locale = lang === 'es' ? 'es-ES' : 'en-GB'
  const spend = euros(p.spendCents)

  const kpis: GrowthKpi[] = [
    {
      key: 'leads',
      label: t('New leads this month', 'Leads nuevos este mes'),
      value: String(p.newLeads),
      delta: t(`${p.leads90d} in 90 days`, `${p.leads90d} en 90 días`),
      tone: 'neutral',
    },
  ]
  // Only when a clinic has said what it spent. "0 € per lead" would be a
  // claim, not a gap.
  if (p.spendCents !== null && p.spendCents > 0) {
    kpis.push(
      {
        key: 'cpl',
        label: t('Cost per lead', 'Coste por lead'),
        value: p.newLeads === 0 ? '—' : euros(Math.round(p.spendCents / p.newLeads))!,
        delta: t(`${spend} spend`, `${spend} de gasto`),
        tone: 'neutral',
      },
      {
        key: 'cpnp',
        label: t('Cost per new patient', 'Coste por paciente nuevo'),
        value: p.converted === 0 ? '—' : euros(Math.round(p.spendCents / p.converted))!,
        delta: t(`${p.converted} converted`, `${p.converted} convertidos`),
        tone: 'neutral',
      },
    )
  }
  kpis.push({
    key: 'revenue',
    label: t('Revenue attributed', 'Ingresos atribuidos'),
    value: euros(p.revenueCents) ?? '0 €',
    delta: t('Estimated value of converted leads', 'Valor estimado de los leads convertidos'),
    tone: 'neutral',
  })
  if (p.spendCents !== null && p.spendCents > 0) {
    kpis.push({
      key: 'roas',
      label: 'ROAS',
      value: `${(p.revenueCents / p.spendCents).toFixed(1)}×`,
      delta: t(`${spend} spend`, `${spend} de gasto`),
      tone: p.revenueCents >= p.spendCents ? 'positive' : 'negative',
    })
  }

  const funnelStages = p.funnel.map((stage) => {
    const [en, es] = STAGE_TITLES[stage.key] ?? [stage.key, stage.key]
    return { key: stage.key, label: t(en, es), count: stage.count, caption: '' }
  })

  // Every stage holds the one after it, except Converted: "Convert to
  // patient" can be pressed before anyone has been seen, so Converted can
  // outnumber Showed. That step is capped at 100% rather than reported as
  // 150% or a negative loss.
  const funnelSteps: GrowthFunnelStep[] = funnelStages.slice(1).map((stage, i) => {
    const previous = funnelStages[i]!
    const pct = previous.count === 0 ? 0 : Math.min(100, Math.round((stage.count / previous.count) * 100))
    return {
      pct,
      delta: `−${Math.max(0, previous.count - stage.count)}`,
      tone: pct >= 75 ? 'neutral' : pct >= 50 ? 'warning' : 'danger',
    }
  })

  // The worst step is named only when there is a funnel to speak of. With
  // no leads every rate is 0 and "0 leads did not reach Contacted" is noise.
  const first = funnelStages[0]
  const last = funnelStages[funnelStages.length - 1]
  let dropOff: GrowthDashboardData['dropOff'] = null
  if (first && first.count > 0 && funnelSteps.length > 0) {
    const worst = funnelSteps.reduce((w, step, i) => (step.pct < funnelSteps[w]!.pct ? i : w), 0)
    funnelSteps[worst]!.emphasis = true
    const lost = Math.max(0, funnelStages[worst]!.count - funnelStages[worst + 1]!.count)
    const to = funnelStages[worst + 1]!.label
    dropOff = {
      summary: t(`Biggest drop-off: ${lost} leads did not reach ${to}.`, `Mayor pérdida: ${lost} leads no llegaron a ${to}.`),
      action: t('Review the pipeline', 'Revisar el embudo'),
    }
  }
  const endToEnd = !first || !last || first.count === 0 ? 0 : (last.count / first.count) * 100

  const channelName = (channel: string) => (channel === GROWTH_DIRECT_CHANNEL ? t('Direct', 'Directo') : channel)
  const row = (c: Omit<GrowthChannelPayload, 'channel'>, channel: string, label: string): GrowthChannelRow => ({
    channel,
    label,
    spend: euros(c.spendCents),
    spendCents: c.spendCents,
    leads: c.leads,
    booked: c.booked,
    showRate: c.showRate,
    costPerNewPatient: euros(c.costPerNewPatientCents),
  })

  const alerts: GrowthAlert[] = p.alerts.map((alert) => {
    switch (alert.key) {
      case 'stale':
        return {
          key: alert.key,
          tone: 'negative',
          title: alert.count === 1
            ? t('1 lead waiting more than a week', '1 lead esperando más de una semana')
            : t(`${alert.count} leads waiting more than a week`, `${alert.count} leads esperando más de una semana`),
          detail: alert.neverContacted === 0
            ? t('From the last 30 days, contacted but not booked', 'De los últimos 30 días, contactados pero sin reserva')
            : alert.neverContacted === alert.count
              ? t('From the last 30 days, never contacted', 'De los últimos 30 días, sin contactar')
              : t(
                  `From the last 30 days, not booked · ${alert.neverContacted} never contacted`,
                  `De los últimos 30 días, sin reserva · ${alert.neverContacted} sin contactar`,
                ),
        }
      case 'no-spend':
        return {
          key: alert.key,
          tone: 'neutral',
          title: t('No ad spend recorded this month', 'No hay gasto en anuncios registrado este mes'),
          detail: t(
            'Cost per lead, cost per new patient and ROAS stay hidden until it is',
            'El coste por lead, el coste por paciente nuevo y el ROAS no se muestran hasta que lo haya',
          ),
        }
      case 'pending-replies':
        return {
          key: alert.key,
          tone: 'neutral',
          title: alert.count === 1
            ? t('1 AI reply is waiting for approval', '1 respuesta de IA espera aprobación')
            : t(`${alert.count} AI replies are waiting for approval`, `${alert.count} respuestas de IA esperan aprobación`),
          detail: t(
            'Drafted for reviews, and nothing posts until someone approves them',
            'Redactadas para reseñas; no se publica nada hasta que alguien las aprueba',
          ),
        }
      case 'unattributed':
        return {
          key: alert.key,
          tone: 'neutral',
          title: alert.count === 1
            ? t('1 lead with no source', '1 lead sin origen')
            : t(`${alert.count} leads with no source`, `${alert.count} leads sin origen`),
          detail: t('They count in the funnel but not in any channel', 'Cuentan en el embudo pero en ningún canal'),
        }
    }
  })

  const [year, month] = p.month.split('-').map(Number)
  const trend = p.trend.map((point) => ({
    label: new Date(`${point.weekStart}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    leads: point.leads,
    booked: point.booked,
  }))

  return {
    periodLabel: new Date(Date.UTC(year!, month! - 1, 15)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    kpis,
    funnelStages,
    funnelSteps,
    endToEndRate: `${endToEnd.toFixed(1)}%`,
    dropOff,
    ai: p.ai,
    alerts,
    channels: p.channels.map((c) => row(c, c.channel, channelName(c.channel))),
    channelTotals: row(p.totals, '', t('All channels', 'Todos los canales')),
    trend,
    trendAxis: [trend[0]?.label, trend[Math.floor(trend.length / 2)]?.label, trend[trend.length - 1]?.label].filter(Boolean) as string[],
  }
}
