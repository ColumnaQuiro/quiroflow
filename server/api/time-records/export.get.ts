import { workdayMonthBounds } from '~/utils/workday'
import { loadTimeRecords, timeRecordsCsv, timeRecordsPdf } from '~/server/utils/timeClock'

// Registro de jornada, a month at a time: ?month=YYYY-MM&format=csv|pdf.
// An owner gets the whole team -- everyone not excluded from clocking, and
// anyone who clocked that month even if they have been since -- and anyone
// else gets their own month. Read with the caller's own client, so RLS
// would narrow it the same way if this did not.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireActiveAccount(event)
  const query = getQuery(event)
  const month = String(query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw createError({ statusCode: 400, statusMessage: 'month must be YYYY-MM' })
  }
  const format = query.format === 'pdf' ? 'pdf' : 'csv'

  let memberIds = [teamMember.id]
  if (teamMember.is_owner) {
    const [{ data: active }, { data: exempt }, { data: clocked }] = await Promise.all([
      supabase.from('team_members').select('id').eq('account_id', teamMember.account_id).is('deleted_at', null),
      supabase.from('time_clock_exemptions').select('team_member_id').eq('account_id', teamMember.account_id),
      supabase.from('time_entries').select('team_member_id').eq('account_id', teamMember.account_id).gte('work_date', workdayMonthBounds(month).first).lte('work_date', workdayMonthBounds(month).last),
    ])
    const excluded = new Set((exempt ?? []).map((e) => e.team_member_id))
    memberIds = [...new Set([...(active ?? []).map((m) => m.id).filter((id) => !excluded.has(id)), ...(clocked ?? []).map((e) => e.team_member_id)])]
  }

  const records = await loadTimeRecords(supabase, month, memberIds)
  if (format === 'pdf') {
    const pdf = await timeRecordsPdf(records)
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `attachment; filename="registro-jornada-${month}.pdf"`)
    return pdf
  }
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="registro-jornada-${month}.csv"`)
  return timeRecordsCsv(records)
})
