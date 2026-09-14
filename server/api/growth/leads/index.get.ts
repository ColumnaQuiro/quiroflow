import { requirePermission } from '~/server/utils/requirePermission'
import {
  CARDS_PER_STAGE,
  LEAD_STAGES,
  STAGE_TITLES,
  channelTag,
  formatEuros,
  timeInStage,
} from '~/server/utils/leads'

// The board, returned already grouped into its columns.
//
// Grouping happens here rather than in the page because the two numbers on a
// column header -- the stage total and its estimated value -- are aggregates
// over ALL leads in the stage, not over the cards returned. A stage holding
// 23 leads shows 23 and the sum of all 23, while rendering the first 25 cards
// and a "+N more". Computing that client-side would need every row.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  // One pass over the open leads for this account. At clinic scale (hundreds
  // of open leads) this is cheaper than seven per-stage round trips, and the
  // totals have to be exact rather than paged anyway.
  const { data: rows, error } = await supabase
    .from('leads')
    .select('id, full_name, stage, channel, source, estimated_value_cents, ai_handling, stage_changed_at, created_at, patient_id')
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .order('stage_changed_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const now = Date.now()
  type LeadRow = NonNullable<typeof rows>[number]

  const byStage = new Map<string, LeadRow[]>(LEAD_STAGES.map((stage) => [stage, []]))
  // A stage outside the known list would be a check-constraint violation, so
  // this cannot silently drop rows -- but it also will not crash if one ever
  // slips in through a future migration.
  for (const row of rows ?? []) byStage.get(row.stage)?.push(row)

  const columns = LEAD_STAGES.map((stage) => {
    const all = byStage.get(stage) ?? []
    const valueCents = all.reduce((sum, lead) => sum + (lead.estimated_value_cents ?? 0), 0)
    const shown = all.slice(0, CARDS_PER_STAGE)

    return {
      key: stage,
      title: STAGE_TITLES[stage],
      count: all.length,
      // "€7,035 care plans" on Converted, "€6,030 est." everywhere else --
      // the money means something different once the plan is actually sold.
      value: `${formatEuros(valueCents) ?? '€0'}${stage === 'converted' ? ' care plans' : ' est.'}`,
      more: all.length > shown.length ? `+${all.length - shown.length} more` : undefined,
      cards: shown.map((lead) => ({
        id: lead.id,
        name: lead.full_name,
        channel: channelTag(lead.channel),
        source: lead.source ?? 'Direct',
        aiHandling: lead.ai_handling,
        timeInStage: timeInStage(lead.stage_changed_at, now),
        value: formatEuros(lead.estimated_value_cents) ?? '—',
      })),
    }
  })

  const open = (rows ?? []).filter((lead) => lead.stage !== 'converted' && lead.stage !== 'lost')
  const openValue = open.reduce((sum, lead) => sum + (lead.estimated_value_cents ?? 0), 0)

  return {
    columns,
    summary: {
      openLeads: open.length,
      estimatedValue: formatEuros(openValue) ?? '€0',
      handledByAi: (rows ?? []).filter((lead) => lead.ai_handling).length,
    },
  }
})
