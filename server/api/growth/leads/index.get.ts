import { requireGrowth } from '~/server/utils/requireGrowth'
import {
  CARDS_PER_STAGE,
  LEAD_STAGES,
  STAGE_TITLES,
  channelTag,
  formatEuros,
  leadDefaultValueCents,
  timeInStage,
} from '~/server/utils/leads'

// The board, returned already grouped into its columns.
//
// Grouping happens here rather than in the page because the two numbers on a
// column header -- the stage total and its estimated value -- are aggregates
// over ALL leads in the stage, not over the cards returned. A stage holding
// 23 leads shows 23 and the sum of all 23, while rendering the first 25 cards
// and a "+N more". Computing that client-side would need every row.
//
// ?q= searches name, email and phone across EVERY lead, not just the cards a
// column draws. The search used to run in the browser over those cards alone,
// so a lead 51st in a stage of 185 could not be found from the board at all.
// The column totals stay the stage's, not the search's: they describe the
// pipeline, and a search should not make it look as if it had shrunk.
//
// ?expand=<stage>[,<stage>] draws every card in those stages ("+N more" is a
// button now), and ?expand=all every card everywhere, which the table view
// asks for -- a table is a list, and a list that stops at 25 per stage
// without saying so is the board's problem again.
const PAGE = 1000

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const query = getQuery(event)
  const term = typeof query.q === 'string' ? query.q.trim().toLowerCase() : ''
  const termDigits = term.replace(/\D/g, '')
  const expand = typeof query.expand === 'string' ? query.expand : ''
  const expandAll = expand === 'all'
  const expanded = new Set(expand.split(',').filter(Boolean))

  // One pass over the leads for this account. At clinic scale (hundreds of
  // leads) this is cheaper than seven per-stage round trips, and the totals
  // have to be exact rather than paged anyway. Read a page at a time: one
  // select stops at PostgREST's row limit (1,000) without an error, and every
  // total and search past it would have been quietly wrong.
  async function allLeads() {
    const out = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, email, phone, stage, channel, source, estimated_value_cents, ai_handling, stage_changed_at, created_at, patient_id')
        .eq('account_id', teamMember.account_id)
        .is('deleted_at', null)
        .order('stage_changed_at', { ascending: false })
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw createError({ statusCode: 500, statusMessage: error.message })
      out.push(...(data ?? []))
      if (!data || data.length < PAGE) return out
    }
  }

  const [rows, defaultCents] = await Promise.all([allLeads(), leadDefaultValueCents(supabase, teamMember.account_id)])

  // Phone by digits, so "617 94 83" finds 34617948363 however it was typed.
  // Three digits at least, or every number containing a "6" would match.
  const matches = (lead: { full_name: string; email: string | null; phone: string | null }) =>
    !term ||
    lead.full_name.toLowerCase().includes(term) ||
    (lead.email ?? '').toLowerCase().includes(term) ||
    (termDigits.length >= 3 && (lead.phone ?? '').replace(/\D/g, '').includes(termDigits))

  // A lead's own figure, else the account's default.
  const valueOf = (lead: { estimated_value_cents: number | null }) => lead.estimated_value_cents ?? defaultCents

  const now = Date.now()
  type LeadRow = NonNullable<typeof rows>[number]

  const byStage = new Map<string, LeadRow[]>(LEAD_STAGES.map((stage) => [stage, []]))
  // A stage outside the known list would be a check-constraint violation, so
  // this cannot silently drop rows -- but it also will not crash if one ever
  // slips in through a future migration.
  for (const row of rows ?? []) byStage.get(row.stage)?.push(row)

  const columns = LEAD_STAGES.map((stage) => {
    const all = byStage.get(stage) ?? []
    const valueCents = all.reduce((sum, lead) => sum + (valueOf(lead) ?? 0), 0)
    const found = all.filter(matches)
    const shown = expandAll || expanded.has(stage) ? found : found.slice(0, CARDS_PER_STAGE)

    return {
      key: stage,
      title: STAGE_TITLES[stage],
      count: all.length,
      // "€7,035 care plans" on Converted, "€6,030 est." everywhere else --
      // the money means something different once the plan is actually sold.
      value: `${formatEuros(valueCents) ?? '€0'}${stage === 'converted' ? ' care plans' : ' est.'}`,
      more: found.length > shown.length ? `+${found.length - shown.length} more` : undefined,
      hidden: found.length - shown.length,
      found: found.length,
      cards: shown.map((lead) => ({
        id: lead.id,
        name: lead.full_name,
        channel: channelTag(lead.channel),
        source: lead.source ?? 'Direct',
        aiHandling: lead.ai_handling,
        timeInStage: timeInStage(lead.stage_changed_at, now),
        value: formatEuros(valueOf(lead)) ?? '—',
      })),
    }
  })

  const open = (rows ?? []).filter((lead) => lead.stage !== 'converted' && lead.stage !== 'lost')
  const openValue = open.reduce((sum, lead) => sum + (valueOf(lead) ?? 0), 0)

  return {
    columns,
    summary: {
      openLeads: open.length,
      estimatedValue: formatEuros(openValue) ?? '€0',
      handledByAi: (rows ?? []).filter((lead) => lead.ai_handling).length,
    },
  }
})
