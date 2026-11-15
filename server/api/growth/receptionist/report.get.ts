import { serverSupabaseServiceRole } from '#supabase/server'
import { requireReceptionist } from '~/server/utils/requireGrowth'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { REPORT_WEEK_CHOICES, reportStartDate, type ReceptionistReport } from '~/utils/receptionistReport'

// Growth > AI receptionist > Report: the last few weeks of what it did, and
// what came of the cancellations and earlier-time offers it handled.
//
// Gated like the rest of the page (communication_config, and the
// receptionist on the subscription), then read in one call with the service
// role: receptionist_report() reads the thread notes and the audit trail,
// which that permission alone does not reach, and is callable by the
// service role only -- its account is the one this guard resolved.
export default defineEventHandler(async (event): Promise<ReceptionistReport> => {
  const { teamMember } = await requireReceptionist(event)
  const accountId = teamMember.account_id
  const asked = Number(getQuery(event).weeks)
  const weeks = (REPORT_WEEK_CHOICES as readonly number[]).includes(asked) ? asked : 8

  const service = serverSupabaseServiceRole(event)
  const { data: clinics } = await service.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1)
  const timeZone = ((clinics ?? []) as { timezone: string | null }[])[0]?.timezone || DEFAULT_CLINIC_TIMEZONE
  const since = reportStartDate(clinicDateOf(new Date(), timeZone), weeks)

  const { data, error } = await (service as any).rpc('receptionist_report', {
    p_account_id: accountId,
    p_since: startOfLocalDate(since, timeZone).toISOString(),
    p_time_zone: timeZone,
  })
  if (error) {
    console.error('[receptionist-report]', error.message)
    throw createError({ statusCode: 500, statusMessage: 'The report could not be read.' })
  }
  return { since, ...(data as Omit<ReceptionistReport, 'since'>) }
})
