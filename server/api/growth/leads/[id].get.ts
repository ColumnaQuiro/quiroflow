import { requireGrowth } from '~/server/utils/requireGrowth'
import { STAGE_TITLES, formatEuros, type LeadStage } from '~/server/utils/leads'

// One lead, with everything the drawer renders: the unified timeline, the
// attribution rail and the consent lines.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)

  // account_id is filtered here as well as by RLS. RLS is what makes it safe;
  // this is what makes a cross-account id a clean 404 rather than an empty
  // row the handler then has to interpret.
  const { data: lead, error } = await supabase
    .from('leads')
    .select(
      'id, reference, full_name, phone, email, stage, channel, source, estimated_value_cents, ai_handling, created_at, patient_id, converted_at, team_members:owner_team_member_id(full_name), clinics:clinic_id(name)',
    )
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  const [{ data: events }, { data: attribution }] = await Promise.all([
    supabase
      .from('lead_events')
      .select('id, kind, title, detail, body, occurred_at')
      .eq('lead_id', id)
      .order('occurred_at', { ascending: true }),
    supabase
      .from('lead_attribution')
      .select('campaign, ad, audience, first_touch, last_touch, cost_cents')
      .eq('lead_id', id)
      .maybeSingle(),
  ])

  const initials = lead.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  // Only the rows that exist. An unattributed lead should show a short rail,
  // not six "—" placeholders implying the data was looked for and missing.
  const attributionRows = attribution
    ? [
        { label: 'Campaign', value: attribution.campaign },
        { label: 'Ad', value: attribution.ad },
        { label: 'Keyword / audience', value: attribution.audience },
        { label: 'First touch', value: attribution.first_touch },
        { label: 'Last touch', value: attribution.last_touch },
        { label: 'Cost per lead', value: formatEuros(attribution.cost_cents) },
      ].filter((row): row is { label: string; value: string } => Boolean(row.value))
    : []

  return {
    id: lead.id,
    reference: lead.reference,
    name: lead.full_name,
    initials: initials || '?',
    createdAt: `created ${new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    aiHandling: lead.ai_handling,
    stage: STAGE_TITLES[lead.stage as LeadStage] ?? lead.stage,
    stageKey: lead.stage,
    source: lead.source ?? 'Direct',
    value: formatEuros(lead.estimated_value_cents) ?? '—',
    owner: lead.team_members?.full_name ?? 'Unassigned',
    patientId: lead.patient_id,
    contact: [lead.phone, lead.email, lead.clinics?.name].filter((line): line is string => Boolean(line)),
    attribution: attributionRows,
    timeline: (events ?? []).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      time: new Date(entry.occurred_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      detail: entry.detail,
      // Passed through as stored. Each kind's extra shape is the integration's
      // to define -- see the migration's note on lead_events.body.
      body: entry.body,
    })),
  }
})
