import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { loadPayMonth } from '~/composables/usePayMonth'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf } from '~/utils/clinicClock'
import { DEFAULT_LEAVE_DAYS } from '~/utils/staffShifts'
import { buildStaffPack, monthDays, staffPackRows } from '~/utils/staffGestoriaPack'
import type { StaffContract } from '~/utils/staffContracts'
import { clinicClosedDays, type TeamAbsence } from '~/utils/teamLeave'
import type { WorkEntry } from '~/utils/workday'
import { toCsv } from '~/server/utils/zipStore'
import { staffPackPdf } from '~/server/utils/staffPackPdf'

// The month's pack for the gestoría: ?month=YYYY-MM&format=json|csv|pdf.
// json is what Personal and Informes › Gestoría show before downloading.
// Owners only, and read with the caller's own client, so RLS would narrow it
// the same way if the check below did not. Who is in it: everyone on the
// team at any point in the month, including someone who left during it.
export default defineEventHandler(async (event) => {
  const { supabase: caller, teamMember } = await requireActiveAccount(event)
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Owners only' })
  const supabase = caller as unknown as SupabaseClient<Database>
  const query = getQuery(event)
  const month = String(query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw createError({ statusCode: 400, statusMessage: 'month must be YYYY-MM' })
  const format = query.format === 'pdf' ? 'pdf' : query.format === 'csv' ? 'csv' : 'json'
  const accountId = teamMember.account_id
  const { first, last } = monthDays(month)
  const year = month.slice(0, 4)

  const { data: clinic } = await supabase.from('clinics').select('timezone, legal_name, tax_id, name').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle()
  const tz = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
  const [members, contracts, entries, absences, allowances, blocks, pay] = await Promise.all([
    supabase.from('team_members').select('id, full_name, deleted_at').eq('account_id', accountId).or(`deleted_at.is.null,deleted_at.gte.${first}`).order('full_name'),
    supabase.from('staff_contracts').select('id, team_member_id, employment_type, modality, starts_on, ends_on, weekly_hours, job_title, convenio, created_at').eq('account_id', accountId),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date').eq('account_id', accountId).is('superseded_by', null).gte('work_date', first).lte('work_date', last).order('at'),
    supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day, status').eq('account_id', accountId).eq('status', 'approved').lte('starts_on', `${year}-12-31`).gte('ends_on', `${year}-01-01`),
    supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', accountId),
    supabase.from('availability_blocks').select('starts_at, ends_at').eq('account_id', accountId).is('practitioner_id', null).is('room_id', null).gte('ends_at', `${year}-01-01`).lte('starts_at', `${year}-12-31T23:59:59`),
    loadPayMonth(supabase, month, tz),
  ])
  const failed = [members, contracts, entries, absences].find((r) => r.error)
  if (failed?.error) throw createError({ statusCode: 500, statusMessage: failed.error.message })

  const pack = buildStaffPack({
    month,
    today: clinicDateOf(new Date(), tz),
    members: members.data ?? [],
    contracts: (contracts.data ?? []) as StaffContract[],
    entries: (entries.data ?? []) as (WorkEntry & { team_member_id: string })[],
    absences: (absences.data ?? []) as TeamAbsence[],
    allowances: new Map((allowances.data ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)])),
    defaultAllowance: DEFAULT_LEAVE_DAYS,
    closed: clinicClosedDays(blocks.data ?? [], tz),
    plans: pay.plans,
    facts: pay.facts,
  })

  if (format === 'json') return { month, ...pack }
  if (format === 'csv') {
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="gestoria-personal-${month}.csv"`)
    return toCsv(staffPackRows(pack))
  }
  const pdf = await staffPackPdf(pack, month, { name: clinic?.legal_name || clinic?.name || '', taxId: clinic?.tax_id ?? null })
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="gestoria-personal-${month}.pdf"`)
  return pdf
})
