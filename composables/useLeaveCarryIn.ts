import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { DEFAULT_LEAVE_DAYS } from '../utils/staffShifts'
import { clinicClosedDays, leaveCarryIn, type TeamAbsence } from '../utils/teamLeave'

// Holiday days carried into `year` (leaveCarryIn in utils/teamLeave.ts), for
// every screen that shows what someone has left: Personal, the year of
// leave, Turnos, the requests waiting, and Mi jornada on the web and in the
// app. Relative imports, because the app (mobile/) builds this file too.
//
// One query when the clinic carries nothing over, which is the default.
// Otherwise last year's approved holiday, allowances and closures, read
// with the caller's client: an owner gets everyone, anyone else themselves.
// Someone who joined during or after last year carries nothing: there was
// no year of theirs to leave days from.
export interface LeaveCarry {
  /** The clinic's setting: up to this many days carry over (0 = none). */
  max: number
  /** Days carried into the year for one person. */
  of: (teamMemberId: string) => number
}

const NONE: LeaveCarry = { max: 0, of: () => 0 }

export async function loadLeaveCarryIn(supabase: SupabaseClient<Database>, opts: { accountId: string; year: number; timeZone: string; memberId?: string }): Promise<LeaveCarry> {
  const { data: account } = await supabase.from('accounts').select('leave_carry_over_days').eq('id', opts.accountId).maybeSingle()
  const max = Number((account as { leave_carry_over_days: number } | null)?.leave_carry_over_days ?? 0)
  if (!max) return NONE

  const prev = opts.year - 1
  let allowQ = supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', opts.accountId)
  let absQ = supabase
    .from('staff_absences')
    .select('id, team_member_id, kind, starts_on, ends_on, half_day, status')
    .eq('account_id', opts.accountId)
    .eq('kind', 'vacation')
    .eq('status', 'approved')
    .lte('starts_on', `${prev}-12-31`)
    .gte('ends_on', `${prev}-01-01`)
  let membersQ = supabase.from('team_members').select('id, created_at').eq('account_id', opts.accountId)
  if (opts.memberId) {
    allowQ = allowQ.eq('team_member_id', opts.memberId)
    absQ = absQ.eq('team_member_id', opts.memberId)
    membersQ = membersQ.eq('id', opts.memberId)
  }
  const [members, allow, abs, blocks] = await Promise.all([
    membersQ,
    allowQ,
    absQ,
    supabase.from('availability_blocks').select('starts_at, ends_at').eq('account_id', opts.accountId).is('practitioner_id', null).is('room_id', null).gte('ends_at', `${prev}-01-01`).lte('starts_at', `${prev}-12-31T23:59:59`),
  ])
  const startedBefore = new Set((members.data ?? []).filter((m) => m.created_at < `${prev}-01-01`).map((m) => m.id))
  const allowance = new Map((allow.data ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)]))
  const absences = (abs.data ?? []) as TeamAbsence[]
  const closed = clinicClosedDays(blocks.data ?? [], opts.timeZone)
  const cache = new Map<string, number>()
  return {
    max,
    of(id: string) {
      if (!startedBefore.has(id)) return 0
      if (!cache.has(id)) cache.set(id, leaveCarryIn(absences.filter((a) => a.team_member_id === id), allowance.get(id) ?? DEFAULT_LEAVE_DAYS, opts.year, closed, max))
      return cache.get(id)!
    },
  }
}
